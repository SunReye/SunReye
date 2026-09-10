/**
 * THE PROCESS'S ONE BROKER POOL — the production wiring of `./broker-pool.ts`.
 *
 * A module singleton on purpose, and the only one in this deliverable: "two
 * integrations on one broker share one client" is only true if every consumer
 * reaches the SAME pool. The EVCC ingest and the Home Assistant export import
 * this; so does `./connection-runtime.ts`, which is what opens a broker row that
 * no integration has claimed yet.
 *
 * Its own module, kept to three imports, so a consumer's test loads the pool
 * without loading the plant spine — and so `mock.module("mqtt")` still reaches
 * the dial, which is how the ingest and export suites run against a fake broker.
 */

import mqtt from "mqtt";

import { log } from "../shared/logging";
import { type BrokerClient, createBrokerPool } from "./broker-pool";

const logger = log("connections");

export const brokerPool = createBrokerPool({
  dial: (url, options) =>
    mqtt.connect(url, {
      username: options.username,
      password: options.password,
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.will ? { will: options.will } : {}),
      reconnectPeriod: options.reconnectPeriod,
    }) as unknown as BrokerClient,
  schedule: (run, ms) => {
    const timer = setTimeout(run, ms);
    // Never hold the process open for a retry: a broker that is down must not
    // stop a shutdown, and the addon's supervisor kills what does not exit.
    timer.unref?.();
    return () => clearTimeout(timer);
  },
  logger,
});
