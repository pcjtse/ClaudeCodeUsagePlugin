import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { UsageDial } from "./actions/usage-dial.js";
import { UsageKey } from "./actions/usage-key.js";
import { ResetKey } from "./actions/reset-key.js";
import { ResetDial } from "./actions/reset-dial.js";

streamDeck.logger.setLevel(LogLevel.TRACE);
streamDeck.actions.registerAction(new UsageDial());
streamDeck.actions.registerAction(new UsageKey());
streamDeck.actions.registerAction(new ResetKey());
streamDeck.actions.registerAction(new ResetDial());
streamDeck.connect();
