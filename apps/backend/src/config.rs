use std::{collections::HashSet, net::IpAddr, path::Path};

use serde::Deserialize;
use thiserror::Error;

#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub public_address: IpAddr,
    pub public_port: u16,
    pub admin_address: IpAddr,
    pub admin_port: u16,
    pub check_interval_seconds: u64,
    pub timeout_seconds: u64,
    pub certificate: String,
    pub private_key: String,
    pub frontend_dir: String,
    pub state_dir: String,
    pub curl: String,
    pub categories: Vec<CategoryConfig>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            public_address: "0.0.0.0".parse().unwrap(),
            public_port: 443,
            admin_address: "127.0.0.1".parse().unwrap(),
            admin_port: 8081,
            check_interval_seconds: 300,
            timeout_seconds: 15,
            certificate: String::new(),
            private_key: String::new(),
            frontend_dir: String::new(),
            state_dir: "/var/lib/methanium-status".into(),
            curl: "curl".into(),
            categories: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CategoryConfig {
    pub id: String,
    pub name: String,
    pub logo: String,
    pub services: Vec<ServiceConfig>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub check_http3: bool,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("failed to read config: {0}")]
    Read(#[from] std::io::Error),
    #[error("failed to parse config: {0}")]
    Parse(String),
    #[error("invalid config: {0}")]
    Invalid(String),
}

impl Config {
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let contents = std::fs::read_to_string(path)?;
        let config = if path.extension().and_then(|value| value.to_str()) == Some("json") {
            serde_json::from_str(&contents)
                .map_err(|error| ConfigError::Parse(error.to_string()))?
        } else {
            toml::from_str(&contents).map_err(|error| ConfigError::Parse(error.to_string()))?
        };
        validate(&config)?;
        Ok(config)
    }
}

fn validate(config: &Config) -> Result<(), ConfigError> {
    if config.check_interval_seconds == 0 || config.timeout_seconds == 0 {
        return Err(ConfigError::Invalid(
            "check interval and timeout must be greater than zero".into(),
        ));
    }
    if config.certificate.is_empty() || config.private_key.is_empty() {
        return Err(ConfigError::Invalid(
            "certificate and private_key are required".into(),
        ));
    }
    if config.frontend_dir.is_empty() {
        return Err(ConfigError::Invalid("frontend_dir is required".into()));
    }

    let mut category_ids = HashSet::new();
    let mut service_ids = HashSet::new();
    for category in &config.categories {
        if category.id.is_empty() || category.name.is_empty() || category.logo.is_empty() {
            return Err(ConfigError::Invalid(
                "category id, name, and logo are required".into(),
            ));
        }
        if !category_ids.insert(&category.id) {
            return Err(ConfigError::Invalid(format!(
                "duplicate category id {}",
                category.id
            )));
        }
        for service in &category.services {
            if service.id.is_empty() || service.name.is_empty() {
                return Err(ConfigError::Invalid(
                    "service id and name are required".into(),
                ));
            }
            if !service_ids.insert(&service.id) {
                return Err(ConfigError::Invalid(format!(
                    "duplicate service id {}",
                    service.id
                )));
            }
            let url = reqwest::Url::parse(&service.url)
                .map_err(|error| ConfigError::Invalid(format!("{}: {error}", service.url)))?;
            if !matches!(url.scheme(), "http" | "https") {
                return Err(ConfigError::Invalid(format!(
                    "{} must use http or https",
                    service.url
                )));
            }
        }
    }
    Ok(())
}
