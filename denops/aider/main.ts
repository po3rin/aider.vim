import { Denops } from "https://deno.land/x/denops_std@v6.4.0/mod.ts";
import * as fn from "https://deno.land/x/denops_std@v6.4.0/function/mod.ts";
import { aiderCommand } from "./aiderCommand.ts";
import { buffer, BufferLayout } from "./buffer.ts";
import { getAiderBufferNr, getCurrentFilePath } from "./utils.ts";

/**
 * The main function that sets up the Aider plugin functionality.
 * @param {Denops} denops - The Denops instance.
 * @returns {Promise<void>}
 */
export async function main(denops: Denops): Promise<void> {
  /**
   * コマンドの引数の数を定義
   * "0"は引数なし、"1"は1つの引数、"*"は複数の引数を意味します。
   */
  type ArgCount = "0" | "1" | "*";

  /**
   * ArgCountに基づいて異なる型の関数を定義
   * "0"の場合は引数なしの関数、"1"の場合は1つの引数を取る関数、
   * "*"の場合は2つの引数を取る関数を意味します。
   */
  type ImplType<T extends ArgCount> = T extends "0" ? (() => Promise<void>)
    : T extends "1" ? ((arg: string) => Promise<void>)
    : ((arg: string, arg2: string) => Promise<void>); // MEMO: ArgCountは*だが現状2つのみ対応している

  /**
   * コマンドのオプションを定義
   * patternは引数のパターンを指定し、completeは補完の種類を指定し、
   * rangeは範囲指定が可能かどうかを示します。
   *
   * @property {string} [pattern] - 引数のパターンを指定します。
   * @property {("file" | "shellcmd")} [complete] - 補完の種類を指定します。ファイル補完またはシェルコマンド補完が可能です。
   * @property {boolean} [range] - 範囲指定が可能かどうかを示します。
   */
  type Opts<T extends ArgCount> = {
    pattern?: T extends "0" ? undefined
      : T extends "1" ? "[<f-args>]"
      : "[<line1>, <line2>]";
    complete?: T extends "1" ? "file" | "shellcmd" : undefined;
    range?: T extends "*" ? boolean : undefined;
  };

  /**
   * Commandは、メソッド名とその実装を含むコマンドオブジェクトを定義します。
   */
  type Command = {
    methodName: string;
    impl: ImplType<ArgCount>;
  };

  /**
   * Denopsディスパッチャー用のコマンドと`command!`宣言を生成します。
   *
   * @param {string} dispatcherMethod - ディスパッチャーで使用されるメソッド名。Vim側に見えるコマンド名は Aider + DispatcherMethod のようになります。
   * @param {ImplType} impl - コマンドの実装関数。
   * @param {Opts} opts - オプション。フィールドはargCountによって変わるので型を参照。
   * @returns {Promise<Command>} - メソッド名、`command!`宣言、実装を含むコマンドオブジェクト。
   */
  async function command<argCount extends ArgCount>(
    dispatcherMethod: string,
    argCount: argCount,
    impl: ImplType<argCount>,
    opts: Opts<argCount> = {} as Opts<argCount>,
  ): Promise<Command> {
    const rangePart = opts.range ? "-range" : "";

    const commandName = "Aider" + dispatcherMethod.charAt(0).toUpperCase() +
      dispatcherMethod.slice(1);
    const completePart = opts.complete ? `-complete=${opts.complete}` : "";
    const patternPart = opts.pattern ?? "[]";

    await denops.cmd(
      `command! -nargs=${argCount} ${completePart} ${rangePart} ${commandName} call denops#notify("${denops.name}", "${dispatcherMethod}", ${patternPart})`,
    );
    return {
      methodName: dispatcherMethod,
      impl: impl,
    };
  }

  const openBufferType: BufferLayout = await buffer.getOpenBufferType(denops);

  const commands: Command[] = [
    await command(
      "sendPrompt",
      "0",
      () => buffer.sendPromptByBuffer(denops, openBufferType),
    ),
    await command("run", "0", async () => {
      if (await buffer.openAiderBuffer(denops, openBufferType)) {
        return;
      }

      const aiderBufnr = await getAiderBufferNr(denops);
      if (aiderBufnr === undefined) {
        // aiderを実行する
        await aiderCommand.run(denops);
        return;
      }

      await denops.cmd(`buffer ${aiderBufnr}`);
    }),
    await command("silentRun", "0", () => aiderCommand.silentRun(denops)),
    await command(
      "addFile",
      "1",
      async (path: string) => {
        const prompt = `/add ${path}`;
        await buffer.sendPromptWithInput(denops, prompt);
      },
      { pattern: "[<f-args>]", complete: "file" },
    ),
    await command(
      "addCurrentFile",
      "0",
      async () => {
        const bufnr = await fn.bufnr(denops, "%");
        if (await getAiderBufferNr(denops) === undefined) {
          if (openBufferType === "floating") {
            await aiderCommand.silentRun(denops);
          } else {
            await buffer.openAiderBuffer(denops, openBufferType);
            await aiderCommand.run(denops);
            await denops.cmd("wincmd p");
            console.log("Run AiderAddCurrentFile again.");
            return;
          }
        }
        if (await buffer.checkIfTerminalBuffer(denops, bufnr)) {
          return;
        }
        const currentFile = await getCurrentFilePath(denops);
        const prompt = `/add ${currentFile}`;
        await buffer.sendPromptWithInput(denops, prompt);
      },
    ),
    await command(
      "addWeb",
      "1",
      async (url: string) => {
        const prompt = `/web ${url}`;
        await buffer.sendPromptWithInput(denops, prompt);
      },
      { pattern: "[<f-args>]" },
    ),
    await command(
      "ask",
      "1",
      async (question: string) => {
        const prompt = `/ask ${question}`;
        await buffer.sendPromptWithInput(denops, prompt);
      },
      { pattern: "[<f-args>]" },
    ),
    await command("exit", "0", () => buffer.exitAiderBuffer(denops)),
    await command(
      "visualTextWithPrompt",
      "*",
      async (start: string, end: string) => {
        await buffer.openFloatingWindowWithSelectedCode(
          denops,
          start,
          end,
          openBufferType,
        );
      },
      { pattern: "[<line1>, <line2>]", range: true },
    ),
    await command("openIgnore", "0", async () => {
      const gitRoot = (await fn.system(denops, "git rev-parse --show-toplevel"))
        .trim();
      const filePathToOpen = `${gitRoot}/.aiderignore`;
      if (await fn.filereadable(denops, filePathToOpen)) {
        await denops.cmd(`edit ${filePathToOpen}`);
        return;
      }
      console.log(".aiderignore file not found.");
    }),
    await command(
      "addIgnoreCurrentFile",
      "0",
      async () => {
        {
          const currentFile = await getCurrentFilePath(denops);

          const gitRoot =
            (await fn.system(denops, "git rev-parse --show-toplevel"))
              .trim();
          const filePathToOpen = `${gitRoot}/.aiderignore`;
          const forAiderIgnorePath = currentFile.replace(gitRoot, "");

          const file = await fn.readfile(denops, filePathToOpen);
          file.push(`!${forAiderIgnorePath}`);

          await fn.writefile(denops, file, filePathToOpen);
          console.log(`Added ${currentFile} to .aiderignore`);
        }
      },
    ),
    await command("debug", "0", () => aiderCommand.debug(denops)),
    await command("hide", "0", async () => {
      await denops.cmd("close!");
      await denops.cmd(`silent! e!`);
    }),
    await command(
      "test",
      "1",
      async (cmd: string) => {
        const prompt = `/test ${cmd}`;
        await buffer.sendPromptWithInput(denops, prompt);
      },
      { pattern: "[<f-args>]", complete: "shellcmd" },
    ),
  ];

  denops.dispatcher = Object.fromEntries(commands.map((command) => [
    command.methodName,
    command.impl as (args: unknown) => Promise<void>,
  ]));
}
