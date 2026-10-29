#!/usr/bin/env node
/** Local profile CLI. SIMULATED only; never calls a real API. */
import * as api from '../module-library/test-resources/ark-native/configuration.mjs';
import {createSimulatorCli,runSimulatorCli} from './simulator-cli.mjs';
export const main=createSimulatorCli({provider:'ark',label:'Ark',commandName:'simulator:ark',api});
runSimulatorCli(main,import.meta.url);
