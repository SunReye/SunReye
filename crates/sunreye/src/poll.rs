//! One device's poll: run the read plan, decode what answered.

use std::sync::Arc;

use crate::decode::{Block, Words, decode, plan_reads, split_block};
use crate::modbus::{Client, Error};
use crate::profile::Profile;

#[derive(Debug)]
pub struct DevicePoller {
    profile: Arc<Profile>,
    unit: u8,
    plan: Vec<Block>,
}

impl DevicePoller {
    pub fn new(profile: Arc<Profile>, unit: u8) -> Self {
        let plan = plan_reads(&profile);
        Self { profile, unit, plan }
    }

    /// The reads the next poll makes. A device that refuses a spanning read stays split.
    pub fn plan(&self) -> &[Block] {
        &self.plan
    }

    /// Reads every block and decodes the registers that answered.
    ///
    /// A refused spanning block is replaced by its mapped registers and read again; a refused plain
    /// block leaves its registers absent. Any other error ends the poll: the caller drops the client.
    pub async fn poll(&mut self, client: &mut Client) -> Result<Vec<(String, f64)>, Error> {
        let mut words = Words::new();
        let mut index = 0;
        while let Some(&block) = self.plan.get(index) {
            match self.read_block(client, block).await? {
                Read::Words(read) => {
                    words.extend((block.start..).zip(read));
                    index += 1;
                }
                Read::Split(split) => {
                    self.plan.splice(index..=index, split);
                }
                Read::Refused => index += 1,
            }
        }
        Ok(decode(&self.profile, &words))
    }

    async fn read_block(&self, client: &mut Client, block: Block) -> Result<Read, Error> {
        match client.read_holding(self.unit, block.start, block.count).await {
            Ok(words) => Ok(Read::Words(words)),
            Err(Error::Exception(_)) if block.grouped => Ok(Read::Split(split_block(&self.profile, block))),
            Err(Error::Exception(code)) => {
                log_refused(block, code);
                Ok(Read::Refused)
            }
            Err(error) => Err(error),
        }
    }
}

fn log_refused(block: Block, code: u8) {
    tracing::warn!(start = block.start, count = block.count, code, "device refused a read");
}

enum Read {
    Words(Vec<u16>),
    /// The device refused a spanning block; these plain blocks replace it.
    Split(Vec<Block>),
    Refused,
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::time::Duration;

    use sunreye_sim::{Simulator, profile_case};

    use super::*;
    use crate::modbus::Transport;
    use crate::profile::Bundle;

    const PROFILES: [&str; 3] = ["deye-sg01hp3", "deye-sg05lp3", "deye-sun20k-sg05lp3"];

    async fn poll_case(profile_id: &str, case: &str) -> (BTreeMap<String, f64>, BTreeMap<String, f64>) {
        let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
        let fixture = profile_case(&oracle, profile_id, case).expect("fixture");
        let sim = Simulator::start(fixture.registers, &[1]).await.expect("sim");
        let mut client =
            Client::connect(Transport::Tcp, "127.0.0.1", sim.addr.port(), Duration::from_secs(5))
                .await
                .expect("connect");
        let profile = Bundle::official().expect("bundle").profile(profile_id).expect("profile").clone();
        let got = DevicePoller::new(profile, 1).poll(&mut client).await.expect("poll");
        (got.into_iter().collect(), fixture.readings)
    }

    #[tokio::test]
    async fn a_poll_of_the_simulator_decodes_what_the_oracle_decoded() {
        for id in PROFILES {
            let (got, want) = poll_case(id, "ramp").await;
            assert_eq!(got, want, "{id}");
        }
    }

    #[tokio::test]
    async fn a_refused_first_block_leaves_only_its_registers_absent() {
        let (got, want) = poll_case("deye-sg05lp3", "first-block-absent").await;
        assert_eq!(got, want);
    }

    #[tokio::test]
    async fn a_silent_device_ends_the_poll_with_a_timeout() {
        let sim = Simulator::start(sunreye_sim::Registers::default(), &[]).await.expect("sim");
        let mut client =
            Client::connect(Transport::Tcp, "127.0.0.1", sim.addr.port(), Duration::from_millis(100))
                .await
                .expect("connect");
        let profile = Bundle::official().expect("bundle").profile("deye-sg05lp3").expect("profile").clone();
        assert_eq!(DevicePoller::new(profile, 1).poll(&mut client).await, Err(Error::Timeout));
    }
}
