import { ANTORA_DEFAULTS } from "./lib/constants/Enum";
import { ConfluenceClientV1 } from "./lib/client/ConfluenceClientV1";
import { ConfluenceClient } from "./lib/client/ConfluenceClient";
import {
  buildPageStructure,
  deletePages,
  getPagesToBeRemoved,
  getRenamedPages,
  publish,
} from "./lib/service/PageService";
import { BufferFile } from "vinyl";
import { getLogger } from "./lib/Logger";
import {
  createState,
  initializeState,
  updateState,
} from "./lib/service/StateService";
import { AntoraPlaybook, CaptainConfig, PageRepresentation } from "./lib/types";

const LOGGER = getLogger();

const publishToConfluence = async (
  destConfig: CaptainConfig,
  files: BufferFile[],
  playbook: AntoraPlaybook,
) => {
  if (process.env.SKIP_CONFLUENCE) {
    LOGGER.info(
      "Skip publishing to Confluence, because SKIP_CONFLUENCE was set",
    );
    return;
  }
  LOGGER.info(`Publishing ${playbook.site.title} to Confluence`);
  const outPutDir = playbook.output.dir || ANTORA_DEFAULTS.OUTPUT_DIR;
  const confluenceClient: ConfluenceClient = new ConfluenceClientV1({
    editorVersion: destConfig.editorVersion || "v1",
    baseUrl: new URL(destConfig.confluenceApi),
    spaceKey: destConfig.confluenceSpace,
    ancestorId: destConfig.ancestorId,
    captainName: destConfig.captainName,
  });
  await confluenceClient.init();
  const pageStructure = new Map();
  pageStructure.set("inventory", new Map());
  pageStructure.set("flat", []);

  const state = await initializeState(confluenceClient);
  if (state) {
    const stateValues: PageRepresentation[] = Object.values(
      JSON.parse(state.value),
    );
    await buildPageStructure(files, pageStructure, destConfig);

    const removals = getPagesToBeRemoved(stateValues, pageStructure);
    if (removals.length > 0) {
      LOGGER.info("Removing untracked pages");
      await deletePages(confluenceClient, removals);
    }

    const renames = getRenamedPages(stateValues, pageStructure);

    LOGGER.info("Publishing pages");
    await publish(
      confluenceClient,
      outPutDir,
      pageStructure,
      destConfig.showBanner || false,
      pageStructure.get("flat"),
      renames,
    );

    LOGGER.info("Writing state to Confluence");

    await updateState(confluenceClient, {
      ...state,
      value: JSON.stringify(Object.fromEntries(pageStructure.get("inventory"))),
    });
  } else {
    await buildPageStructure(files, pageStructure, destConfig);

    LOGGER.info("Publishing pages");

    await publish(
      confluenceClient,
      outPutDir,
      pageStructure,
      destConfig.showBanner || false,
      pageStructure.get("flat"),
    );

    await createState(
      confluenceClient,
      JSON.stringify(Object.fromEntries(pageStructure.get("inventory"))),
    );
  }

  return {};
};

module.exports = publishToConfluence;
