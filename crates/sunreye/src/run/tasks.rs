//! Every background task the core owns, stopped in reverse start order.

use std::future::Future;
#[cfg(test)]
use std::sync::Arc;

use tokio::sync::{Mutex, watch};
use tokio::task::JoinSet;

/// Tasks that end once `stop` turns true.
#[derive(Debug, Default)]
pub(crate) struct Running {
    pub stop: watch::Sender<bool>,
    pub tasks: JoinSet<()>,
}

impl Running {
    /// One task, handed what turns true when it is to stop.
    pub fn one<F>(task: impl FnOnce(watch::Receiver<bool>) -> F) -> Self
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let mut running = Self::default();
        running.tasks.spawn(task(running.stop.subscribe()));
        running
    }

    pub(super) async fn stop(mut self) {
        self.stop.send_replace(true);
        while self.tasks.join_next().await.is_some() {}
    }
}

#[derive(Debug, Default)]
pub(crate) struct Tasks {
    entries: Mutex<Vec<(&'static str, Running)>>,
    #[cfg(test)]
    pub seams: Arc<super::Seams>,
}

impl Tasks {
    pub async fn start(&self, name: &'static str, running: Running) {
        self.entries.lock().await.push((name, running));
    }

    /// Stops `name`'s tasks, then runs what `spawn` returns in their place, keeping its stop position. Once
    /// `name` is stopped, `spawn` is dropped unrun.
    pub async fn restart<E>(
        &self,
        name: &str,
        spawn: impl Future<Output = Result<Running, E>>,
    ) -> Result<(), E> {
        let mut entries = self.entries.lock().await;
        let Some(running) = find(&mut entries, name) else { return Ok(()) };
        std::mem::take(running).stop().await;
        *running = spawn.await?;
        Ok(())
    }

    /// Runs `task` beside `name`'s tasks, handing it their stop signal. Once `name` is stopped, `task` is dropped
    /// unrun.
    pub async fn spawn<F>(&self, name: &str, task: impl FnOnce(watch::Receiver<bool>) -> F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let mut entries = self.entries.lock().await;
        if let Some(running) = find(&mut entries, name) {
            while running.tasks.try_join_next().is_some() {}
            running.tasks.spawn(task(running.stop.subscribe()));
        }
    }

    /// Stops the last started first. Unlocked while one stops, so a stopping task may still restart another.
    pub async fn stop_all(&self) {
        loop {
            let last = self.entries.lock().await.pop();
            let Some((name, running)) = last else { return };
            running.stop().await;
            tracing::debug!(task = name, "stopped");
            #[cfg(test)]
            self.seams.record(name);
        }
    }
}

fn find<'a>(entries: &'a mut [(&'static str, Running)], name: &str) -> Option<&'a mut Running> {
    entries.iter_mut().find(|(n, _)| *n == name).map(|(_, running)| running)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;

    /// Runs until stopped, then counts itself out.
    fn counted(ended: &Arc<AtomicUsize>) -> Running {
        let ended = Arc::clone(ended);
        Running::one(|mut stopped| async move {
            stopped.wait_for(|stop| *stop).await.ok();
            ended.fetch_add(1, Ordering::SeqCst);
        })
    }

    fn events(tasks: &Tasks) -> Vec<&'static str> {
        tasks.seams.events.lock().expect("events").clone()
    }

    #[tokio::test(start_paused = true)]
    async fn tasks_stop_in_reverse_start_order_and_a_restart_keeps_its_place() {
        let (tasks, ended) = (Tasks::default(), Arc::new(AtomicUsize::new(0)));
        for name in ["a", "b", "c"] {
            tasks.start(name, counted(&ended)).await;
        }
        tasks.restart("a", async { Ok::<_, ()>(counted(&ended)) }).await.expect("restart");
        assert_eq!(ended.load(Ordering::SeqCst), 1, "the restart stopped the first a");

        tasks.stop_all().await;

        assert_eq!(events(&tasks), ["c", "b", "a"]);
        assert_eq!(ended.load(Ordering::SeqCst), 4);
    }

    #[tokio::test(start_paused = true)]
    async fn once_stopped_nothing_restarts_or_spawns() {
        let tasks = Tasks::default();
        tasks.start("a", Running::default()).await;
        tasks.stop_all().await;

        let restarted = tasks.restart("a", async { Err::<Running, _>("spawned") }).await;
        let called = AtomicBool::new(false);
        let record = |_| {
            called.store(true, Ordering::SeqCst);
            std::future::ready(())
        };
        tasks.spawn("a", record).await;

        assert_eq!(restarted, Ok(()));
        assert!(!called.load(Ordering::SeqCst), "spawn ran its task after the stop");
        assert!(tasks.entries.lock().await.is_empty());
    }
}
