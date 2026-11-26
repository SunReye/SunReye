//! Discovery over a client, against fake devices holding a SunSpec map per the SunSpec
//! Information Model Specification: the marker `SunS` at register 50001, a common model (1) of
//! 4 registers, a single-phase inverter model (101) of 6, the end model 0xFFFF.

use std::time::Duration;

use sunreye_profile::{Block, Framing};

use super::discover;
use crate::transport::{Client, Error, fake};

const TIMEOUT: Duration = Duration::from_millis(300);

fn map() -> Vec<u16> {
    let mut map = vec![0x5375, 0x6e53, 1, 4, 0, 0, 0, 0, 101, 6];
    map.extend([0; 6]);
    map.extend([0xFFFF, 0]);
    map
}

/// The plan is compiled at connect, for the framing of the endpoint.
#[tokio::test]
async fn at_connect_the_chain_compiles_the_read_plan_of_the_framing() {
    let stick = fake::serve_map("127.0.0.1", Framing::SolarmanV5, 1, 50000, &map()).await;
    let mut client = Client::connect(&stick.endpoint(), TIMEOUT).await.unwrap();

    let chain = discover(&mut client, 1).await.unwrap().unwrap();

    let plan = chain.read_plan(Framing::SolarmanV5.gap_tolerance());
    let whole = Block {
        start: 50004,
        count: 12,
        grouped: false,
        merged: true,
    };
    assert_eq!(plan, [whole]);
    assert_eq!(chain.variant(), Some(101));
}

#[tokio::test]
async fn a_device_without_the_marker_holds_no_chain() {
    let deye = fake::serve_unit("127.0.0.1", Framing::Tcp, 1).await;
    let mut client = Client::connect(&deye.endpoint(), TIMEOUT).await.unwrap();

    assert_eq!(discover(&mut client, 1).await, Ok(None));
}

#[tokio::test]
async fn a_unit_that_never_answers_ends_the_discovery() {
    let other = fake::serve_map("127.0.0.1", Framing::Tcp, 2, 40000, &map()).await;
    let mut client = Client::connect(&other.endpoint(), TIMEOUT).await.unwrap();

    assert_eq!(discover(&mut client, 1).await, Err(Error::Timeout));
}
