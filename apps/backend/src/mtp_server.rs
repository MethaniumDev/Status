use std::{net::IpAddr, sync::Arc};

use mtp::{
    codec::{CommunicationType, CommunicationValue, DataType, DataValue, TypeMap},
    host::{HostConfig, Policy, SendMode},
    webserver::{MTPWebServer, WebMTPConnection, WebServerConfig},
};
use tokio::sync::watch;

pub async fn serve(
    address: IpAddr,
    port: u16,
    certificate: Vec<u8>,
    private_key: Vec<u8>,
    state: Arc<crate::AppState>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let policy = Policy::default().with_send_mode(SendMode::SingleStreamPerMessage);
    let host = HostConfig::new(address, port, certificate, private_key).with_policy(policy);
    let web = WebServerConfig::new()
        .mtp_path("/mtp")
        .serve_tcp_https(false);
    let mut server = MTPWebServer::new(host, web).await?;
    tracing::info!(address = %server.local_addr(), "MTP WebTransport listening");

    let mut next_connection_id = 1_u64;
    while let Some(connection) = server.accept().await? {
        let connection_id = next_connection_id;
        next_connection_id += 1;
        tracing::info!(connection_id, "MTP client connected");
        let updates = state.updates.subscribe();
        let state = Arc::clone(&state);
        tokio::spawn(
            async move { serve_connection(connection_id, connection, updates, state).await },
        );
    }
    Ok(())
}

async fn serve_connection(
    connection_id: u64,
    connection: WebMTPConnection,
    mut updates: watch::Receiver<String>,
    state: Arc<crate::AppState>,
) {
    let sender = connection.sender.clone();
    let type_map = connection.codec.type_map().clone();
    loop {
        tokio::select! {
            request = connection.receiver.receive() => {
                let request = match request {
                    Ok(request) => request,
                    Err(error) => {
                        tracing::warn!(connection_id, %error, "failed to receive MTP request");
                        break;
                    }
                };
                if request.is_type(CommunicationType::GetStatus) {
                    let payload = state.snapshot_json().await;
                    let bytes = payload.len();
                    let response = snapshot(&type_map, payload).with_id(request.get_id());
                    tracing::info!(connection_id, request_id = request.get_id(), bytes, "received status request");
                    if let Err(error) = sender.send(&response).await {
                        tracing::warn!(connection_id, request_id = request.get_id(), %error, "failed to send status response");
                        break;
                    }
                    tracing::info!(connection_id, request_id = request.get_id(), "sent status response");
                } else {
                    tracing::warn!(connection_id, "received unsupported MTP request");
                }
            }
            changed = updates.changed() => {
                if changed.is_err() {
                    tracing::info!(connection_id, "status update channel closed");
                    break;
                }
                let payload = updates.borrow_and_update().clone();
                let bytes = payload.len();
                let response = snapshot(&type_map, payload);
                if let Err(error) = sender.send(&response).await {
                    tracing::warn!(connection_id, %error, "failed to push status update");
                    break;
                }
                tracing::info!(connection_id, bytes, "pushed status update");
            }
        }
    }
    tracing::info!(connection_id, "MTP client disconnected");
}

fn snapshot(type_map: &TypeMap, payload: String) -> CommunicationValue {
    CommunicationValue::from_comm(CommunicationType::StatusSnapshot, type_map).add_typed(
        DataType::Payload,
        type_map,
        DataValue::Str(payload),
    )
}
