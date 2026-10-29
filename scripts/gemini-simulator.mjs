#!/usr/bin/env node
/** Local profile CLI. SIMULATED only; never calls a real API. */
import * as api from '../module-library/test-resources/gemini-native/configuration.mjs';
import {createSimulatorCli,runSimulatorCli} from './simulator-cli.mjs';
export const main=createSimulatorCli({provider:'gemini',label:'Gemini',commandName:'simulator',api});
runSimulatorCli(main,import.meta.url);
