use std::{process::Stdio, sync::Arc, time::Duration};

use chrono::Utc;
use reqwest::redirect::Policy;
use tokio::{process::Command, sync::RwLock, time::Instant};

use crate::{
    config::Config,
    model::{Service, ServiceStatus},
};

pub async fn run(
    config: Arc<Config>,
    categories: Arc<RwLock<Vec<crate::model::Category>>>,
    publish: Arc<dyn Fn() + Send + Sync>,
) {
    let client = reqwest::Client::builder()
        .redirect(Policy::limited(10))
        .timeout(Duration::from_secs(config.timeout_seconds))
        .user_agent("Methanium-Status/0.1")
        .build()
        .expect("HTTP client configuration is valid");
    let mut interval = tokio::time::interval(Duration::from_secs(config.check_interval_seconds));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;
        let jobs = {
            let categories = categories.read().await;
            categories
                .iter()
                .enumerate()
                .flat_map(|(category_index, category)| {
                    category
                        .services
                        .iter()
                        .enumerate()
                        .map(move |(service_index, service)| {
                            (category_index, service_index, service.clone())
                        })
                })
                .collect::<Vec<_>>()
        };

        let mut checks = tokio::task::JoinSet::new();
        for (category_index, service_index, service) in jobs {
            let client = client.clone();
            let config = Arc::clone(&config);
            checks.spawn(async move {
                (
                    category_index,
                    service_index,
                    check_service(&client, &config, service).await,
                )
            });
        }
        while let Some(result) = checks.join_next().await {
            match result {
                Ok((category_index, service_index, service)) => {
                    categories.write().await[category_index].services[service_index] = service;
                }
                Err(error) => tracing::error!(%error, "service check task failed"),
            }
        }
        publish();
    }
}

async fn check_service(client: &reqwest::Client, config: &Config, mut service: Service) -> Service {
    let started = Instant::now();
    let result = client.get(&service.url).send().await;
    service.checked_at = Some(Utc::now());
    service.latency_ms = Some(started.elapsed().as_millis() as u64);
    service.error = None;
    service.status_code = None;

    match result {
        Ok(response) => {
            let status = response.status();
            service.status_code = Some(status.as_u16());
            if !is_operational_status(status) {
                service.status = ServiceStatus::HttpError;
                service.error = Some(format!("HTTP {}", status.as_u16()));
                return service;
            }
        }
        Err(error) if error.is_timeout() => {
            service.status = ServiceStatus::TimedOut;
            service.error = Some("Request timed out".into());
            return service;
        }
        Err(error) => {
            service.status = ServiceStatus::Offline;
            service.error = Some(error.to_string());
            return service;
        }
    }

    if service.check_http3 {
        match check_http3(config, &service.url).await {
            Ok((status, latency)) if (200..400).contains(&status) => {
                service.latency_ms = Some(service.latency_ms.unwrap_or(0).max(latency));
            }
            Ok((status, _)) => {
                service.status = ServiceStatus::Http3Error;
                service.error = Some(format!("HTTP/3 returned {status}"));
                return service;
            }
            Err(error) => {
                service.status = ServiceStatus::Http3Error;
                service.error = Some(error);
                return service;
            }
        }
    }

    service.status = ServiceStatus::Online;
    service
}

async fn check_http3(config: &Config, url: &str) -> Result<(u16, u64), String> {
    let output = Command::new(&config.curl)
        .args([
            "--http3-only",
            "--location",
            "--silent",
            "--show-error",
            "--output",
            "/dev/null",
            "--write-out",
            "%{http_code}\t%{time_total}",
            "--max-time",
            &config.timeout_seconds.to_string(),
            url,
        ])
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| format!("HTTP/3 probe failed to start: {error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if error.is_empty() {
            "HTTP/3 connection failed".into()
        } else {
            error
        });
    }
    parse_http3_output(&String::from_utf8_lossy(&output.stdout))
}

fn is_operational_status(status: reqwest::StatusCode) -> bool {
    status.is_success() || status.is_redirection()
}

fn parse_http3_output(value: &str) -> Result<(u16, u64), String> {
    let (status, seconds) = value
        .trim()
        .split_once('\t')
        .ok_or("Invalid HTTP/3 probe output")?;
    let status = status.parse().map_err(|_| "Invalid HTTP/3 status code")?;
    let seconds: f64 = seconds.parse().map_err(|_| "Invalid HTTP/3 latency")?;
    Ok((status, (seconds * 1_000.0) as u64))
}

#[cfg(test)]
mod tests {
    use reqwest::StatusCode;

    use super::*;

    #[test]
    fn classifies_http_statuses() {
        assert!(is_operational_status(StatusCode::OK));
        assert!(is_operational_status(StatusCode::TEMPORARY_REDIRECT));
        assert!(!is_operational_status(StatusCode::BAD_REQUEST));
        assert!(!is_operational_status(StatusCode::SERVICE_UNAVAILABLE));
    }

    #[test]
    fn parses_http3_probe_result() {
        assert_eq!(parse_http3_output("204\t0.125").unwrap(), (204, 125));
        assert!(parse_http3_output("not-a-result").is_err());
    }
}
