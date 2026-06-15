import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { UsageDial } from "./actions/usage-dial.js";
import { UsageKey } from "./actions/usage-key.js";

streamDeck.logger.setLevel(LogLevel.TRACE);
streamDeck.actions.registerAction(new UsageDial());
streamDeck.actions.registerAction(new UsageKey());
streamDeck.connect();
