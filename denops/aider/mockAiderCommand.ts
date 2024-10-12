import { emit } from "https://deno.land/x/denops_std@v6.4.0/autocmd/mod.ts";
import * as fn from "https://deno.land/x/denops_std@v6.4.0/function/mod.ts";
import type { Denops } from "https://deno.land/x/denops_std@v6.4.0/mod.ts";
import type { AiderCommand } from "./aiderCommand.ts";

let mockAiderBufnr: number | undefined = undefined;

export const commands: AiderCommand = {
  run: async (denops: Denops): Promise<undefined> => {
    const bufnr = await fn.bufnr(denops, "%");
    await denops.cmd("file dummyaider"); // set buffer name

    await emit(denops, "User", "AiderOpen");
    mockAiderBufnr = bufnr;
  },

  silentRun: async (denops: Denops): Promise<undefined> => {
    await denops.cmd("enew");
    await commands.run(denops);
    await denops.cmd("b#"); // hide buffer
  },

  sendPrompt: async (denops: Denops, _jobId: number, prompt: string): Promise<undefined> => {
    await fn.feedkeys(denops, `ainput: ${prompt}\n`, "x");
  },

  exit: async (denops: Denops, _jobId: number, _bufnr: number): Promise<undefined> => {
    if (mockAiderBufnr === undefined) {
      return;
    }

    await fn.bufnr(denops, mockAiderBufnr.toString(), true);
    await denops.cmd("bd!");
  },

  // deno-lint-ignore require-await
  checkIfAiderBuffer: async (_: Denops, bufnr: number): Promise<boolean> => {
    return bufnr === mockAiderBufnr;
  },
  isTestMode: () => true,
};
