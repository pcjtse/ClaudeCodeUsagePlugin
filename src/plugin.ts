import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { UsageDial } from "./actions/usage-dial.js";

streamDeck.logger.setLevel(LogLevel.TRACE);
streamDeck.actions.registerAction(new UsageDial());
streamDeck.connect();
