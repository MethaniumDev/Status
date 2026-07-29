use std::{io::ErrorKind, path::PathBuf};

use chrono::Utc;
use thiserror::Error;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::model::{Incident, NewIncident};

pub struct IncidentStore {
    path: PathBuf,
    incidents: Mutex<Vec<Incident>>,
}

#[derive(Debug, Error)]
pub enum IncidentError {
    #[error("incident title and message cannot be empty")]
    Empty,
    #[error("incident not found")]
    NotFound,
    #[error("active incidents cannot be deleted")]
    Active,
    #[error("failed to persist incidents: {0}")]
    Storage(#[from] std::io::Error),
    #[error("failed to parse incidents: {0}")]
    Parse(#[from] serde_json::Error),
}

impl IncidentStore {
    pub async fn load(path: PathBuf) -> Result<Self, IncidentError> {
        let incidents = match tokio::fs::read(&path).await {
            Ok(contents) => serde_json::from_slice(&contents)?,
            Err(error) if error.kind() == ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            path,
            incidents: Mutex::new(incidents),
        })
    }

    pub async fn list(&self) -> Vec<Incident> {
        self.incidents.lock().await.clone()
    }

    pub async fn create(&self, input: NewIncident) -> Result<Incident, IncidentError> {
        if input.title.trim().is_empty() || input.message.trim().is_empty() {
            return Err(IncidentError::Empty);
        }
        let incident = Incident {
            id: Uuid::new_v4(),
            title: input.title.trim().to_owned(),
            message: input.message.trim().to_owned(),
            severity: input.severity,
            created_at: Utc::now(),
            resolved_at: None,
        };
        let mut incidents = self.incidents.lock().await;
        incidents.push(incident.clone());
        self.persist(&incidents).await?;
        Ok(incident)
    }

    pub async fn resolve(&self, id: Uuid) -> Result<Incident, IncidentError> {
        let mut incidents = self.incidents.lock().await;
        let incident = incidents
            .iter_mut()
            .find(|incident| incident.id == id)
            .ok_or(IncidentError::NotFound)?;
        if incident.resolved_at.is_none() {
            incident.resolved_at = Some(Utc::now());
        }
        let resolved = incident.clone();
        self.persist(&incidents).await?;
        Ok(resolved)
    }

    pub async fn delete(&self, id: Uuid) -> Result<Incident, IncidentError> {
        let mut incidents = self.incidents.lock().await;
        let index = incidents
            .iter()
            .position(|incident| incident.id == id)
            .ok_or(IncidentError::NotFound)?;
        if incidents[index].resolved_at.is_none() {
            return Err(IncidentError::Active);
        }
        let deleted = incidents.remove(index);
        self.persist(&incidents).await?;
        Ok(deleted)
    }

    async fn persist(&self, incidents: &[Incident]) -> Result<(), std::io::Error> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let temporary = self.path.with_extension("json.tmp");
        let contents = serde_json::to_vec_pretty(incidents).map_err(std::io::Error::other)?;
        tokio::fs::write(&temporary, contents).await?;
        tokio::fs::rename(temporary, &self.path).await
    }
}

#[cfg(test)]
mod tests {
    use crate::model::{NewIncident, Severity};

    use super::*;

    #[tokio::test]
    async fn persists_created_and_resolved_incidents() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("incidents.json");
        let store = IncidentStore::load(path.clone()).await.unwrap();
        let created = store
            .create(NewIncident {
                title: "Service disruption".into(),
                message: "Investigating elevated errors.".into(),
                severity: Severity::Major,
            })
            .await
            .unwrap();
        store.resolve(created.id).await.unwrap();

        let reloaded = IncidentStore::load(path).await.unwrap().list().await;
        assert_eq!(reloaded.len(), 1);
        assert!(reloaded[0].resolved_at.is_some());
    }

    #[tokio::test]
    async fn rejects_empty_incidents() {
        let directory = tempfile::tempdir().unwrap();
        let store = IncidentStore::load(directory.path().join("incidents.json"))
            .await
            .unwrap();
        let result = store
            .create(NewIncident {
                title: " ".into(),
                message: "Details".into(),
                severity: Severity::Minor,
            })
            .await;
        assert!(matches!(result, Err(IncidentError::Empty)));
    }

    #[tokio::test]
    async fn only_deletes_resolved_incidents() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("incidents.json");
        let store = IncidentStore::load(path.clone()).await.unwrap();
        let created = store
            .create(NewIncident {
                title: "Service disruption".into(),
                message: "Investigating elevated errors.".into(),
                severity: Severity::Major,
            })
            .await
            .unwrap();

        assert!(matches!(
            store.delete(created.id).await,
            Err(IncidentError::Active)
        ));
        store.resolve(created.id).await.unwrap();
        store.delete(created.id).await.unwrap();

        assert!(
            IncidentStore::load(path)
                .await
                .unwrap()
                .list()
                .await
                .is_empty()
        );
    }
}
