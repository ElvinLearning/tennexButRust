//! `tennex doctor`: send each configured provider a test message and report the result.

use crate::providers::{Msg, Registry};
use futures::StreamExt;
use std::time::{Duration, Instant};

pub async fn run(reg: &Registry) -> bool {
    println!("Tennex doctor\n");
    if reg.providers.is_empty() {
        println!("No providers configured. The office runs in offline sim mode.");
        println!("Copy .env.example to .env and add an API key to go live.");
        return true;
    }
    let mut all_ok = true;
    for p in &reg.providers {
        let models = reg.models_for(p).await;
        let Some(model) = models.first().cloned() else {
            // Only Ollama has a dynamic list; it being down is not an error.
            println!("·  {:<24} not running or no models pulled (skipped)", p.label);
            continue;
        };
        let started = Instant::now();
        let msgs = vec![Msg { role: "user", content: "Reply with exactly: SAY: ready".into() }];
        let stream = reg.stream(p.clone(), model.clone(), "You are a health check.".into(), msgs);
        let result = tokio::time::timeout(Duration::from_secs(45), async {
            futures::pin_mut!(stream);
            let mut text = String::new();
            while let Some(item) = stream.next().await {
                text.push_str(&item?);
            }
            Ok::<_, String>(text)
        })
        .await
        .unwrap_or_else(|_| Err("timed out after 45s".into()));
        let ms = started.elapsed().as_millis();
        match result {
            Ok(t) if !t.trim().is_empty() => {
                let reply: String = t.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(60).collect();
                println!("✓  {:<24} {model}  ({ms} ms)  \"{reply}\"", p.label);
            }
            Ok(_) => {
                all_ok = false;
                println!("✗  {:<24} {model}  empty reply", p.label);
            }
            Err(e) => {
                all_ok = false;
                println!("✗  {:<24} {model}  {e}", p.label);
            }
        }
    }
    all_ok
}
