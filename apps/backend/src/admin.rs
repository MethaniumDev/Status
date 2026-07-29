use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use uuid::Uuid;

use crate::{AppState, incidents::IncidentError, model::NewIncident};

pub async fn serve(
    address: SocketAddr,
    frontend: PathBuf,
    state: Arc<AppState>,
) -> std::io::Result<()> {
    let index = frontend.join("index.html");
    let assets = ServeDir::new(frontend).fallback(ServeFile::new(index));
    let app = Router::new()
        .route("/api/admin", get(admin))
        .route("/api/incidents", get(list).post(create))
        .route("/api/incidents/{id}", delete(remove))
        .route("/api/incidents/{id}/resolve", post(resolve))
        .fallback_service(assets)
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, "admin page listening");
    axum::serve(listener, app).await
}

async fn admin() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn list(State(state): State<Arc<AppState>>) -> Json<Vec<crate::model::Incident>> {
    Json(state.incidents.list().await)
}

async fn create(State(state): State<Arc<AppState>>, Json(input): Json<NewIncident>) -> Response {
    match state.incidents.create(input).await {
        Ok(incident) => {
            state.publish().await;
            (StatusCode::CREATED, Json(incident)).into_response()
        }
        Err(error) => error_response(error),
    }
}

async fn resolve(State(state): State<Arc<AppState>>, Path(id): Path<Uuid>) -> Response {
    match state.incidents.resolve(id).await {
        Ok(incident) => {
            state.publish().await;
            Json(incident).into_response()
        }
        Err(error) => error_response(error),
    }
}

async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<Uuid>) -> Response {
    match state.incidents.delete(id).await {
        Ok(_) => {
            state.publish().await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => error_response(error),
    }
}

fn error_response(error: IncidentError) -> Response {
    let status = match error {
        IncidentError::Empty => StatusCode::BAD_REQUEST,
        IncidentError::Active => StatusCode::CONFLICT,
        IncidentError::NotFound => StatusCode::NOT_FOUND,
        IncidentError::Storage(_) | IncidentError::Parse(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (
        status,
        Json(serde_json::json!({ "error": error.to_string() })),
    )
        .into_response()
}
