mod admin;
mod config;
mod incidents;
mod model;
mod monitor;
mod mtp_server;

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::Utc;
use config::Config;
use incidents::IncidentStore;
use model::{Category, Service, ServiceStatus, Snapshot};
use tokio::sync::{RwLock, watch};

pub struct AppState {
    categories: Arc<RwLock<Vec<Category>>>,
    incidents: IncidentStore,
    public_port: u16,
    updates: watch::Sender<String>,
}

impl AppState {
    async fn snapshot(&self) -> Snapshot {
        Snapshot {
            categories: self.categories.read().await.clone(),
            incidents: self.incidents.list().await,
            generated_at: Utc::now(),
        }
    }

    async fn snapshot_json(&self) -> String {
        serde_json::to_string(&self.snapshot().await).expect("snapshot is serializable")
    }

    async fn publish(&self) {
        let payload = self.snapshot_json().await;
        tracing::info!(bytes = payload.len(), "publishing status snapshot");
        self.updates.send_replace(payload);
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("methanium_status=info".parse()?),
        )
        .init();
    let config_path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| "config.toml".into());
    let config = Arc::new(Config::load(&config_path)?);
    let state_dir = PathBuf::from(&config.state_dir);
    tokio::fs::create_dir_all(&state_dir).await?;

    let categories = Arc::new(RwLock::new(load_categories(&config)?));
    let incidents = IncidentStore::load(state_dir.join("incidents.json")).await?;
    let initial = serde_json::to_string(&Snapshot {
        categories: categories.read().await.clone(),
        incidents: incidents.list().await,
        generated_at: Utc::now(),
    })?;
    let (updates, _) = watch::channel(initial);
    let state = Arc::new(AppState {
        categories: Arc::clone(&categories),
        incidents,
        public_port: config.public_port,
        updates,
    });

    let monitor_config = Arc::clone(&config);
    let monitor_state = Arc::clone(&state);
    let publish: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
        let state = Arc::clone(&monitor_state);
        tokio::spawn(async move { state.publish().await });
    });
    tokio::spawn(monitor::run(monitor_config, categories, publish));

    let admin_address = (config.admin_address, config.admin_port).into();
    let admin = admin::serve(
        admin_address,
        PathBuf::from(&config.frontend_dir),
        Arc::clone(&state),
    );
    let mtp = mtp_server::serve(
        config.public_address,
        config.public_port,
        tokio::fs::read(&config.certificate).await?,
        tokio::fs::read(&config.private_key).await?,
        state,
    );
    tokio::try_join!(admin, async { mtp.await.map_err(std::io::Error::other) })?;
    Ok(())
}

fn load_categories(config: &Config) -> Result<Vec<Category>, std::io::Error> {
    config
        .categories
        .iter()
        .map(|category| {
            Ok(Category {
                id: category.id.clone(),
                name: category.name.clone(),
                logo: logo_data_url(Path::new(&category.logo))?,
                services: category
                    .services
                    .iter()
                    .map(|service| Service {
                        id: service.id.clone(),
                        name: service.name.clone(),
                        url: service.url.clone(),
                        check_http3: service.check_http3,
                        status: ServiceStatus::Unknown,
                        status_code: None,
                        latency_ms: None,
                        error: None,
                        checked_at: None,
                    })
                    .collect(),
            })
        })
        .collect()
}

fn logo_data_url(path: &Path) -> Result<String, std::io::Error> {
    let media_type = match path.extension().and_then(|value| value.to_str()) {
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("jpg" | "jpeg") => "image/jpeg",
        _ => "application/octet-stream",
    };
    Ok(format!(
        "data:{media_type};base64,{}",
        STANDARD.encode(std::fs::read(path)?)
    ))
}
