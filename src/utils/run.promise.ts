import { spawn } from "child_process";

import { createError } from "@ezez/errors";
import treeKill from "tree-kill";

import type { SpawnOptions } from "child_process";

type RunResult = {
    stdOut: string;
    stdErr: string;
    code: number | null;
};

const RunError = createError<RunResult>("RunError");

interface Events {
    onOut?: (s: string) => void;
    onErr?: (s: string) => void;
}

type KillFn = (signal: NodeJS.Signals) => void;

const run = (command: string, args: string[], events?: Events, options?: SpawnOptions): (
Promise<RunResult> & { kill: KillFn }
) => {
    const { onOut, onErr } = events ?? {};

    let terminated = false,
        cmd: ReturnType<typeof spawn> | undefined;

    const safeKill = (signal: NodeJS.Signals) => {
        if (terminated) {
            return;
        }

        if (cmd?.pid !== undefined) {
            treeKill(cmd.pid, signal);
        }
    };

    // @ts-expect-error Idk better solution
    const p: Promise<RunResult> & { kill: typeof safeKill } = new Promise((resolve, reject) => {
        cmd = spawn(command, args, options!);

        let stdOut: string, stdErr: string;

        stdOut = "";
        stdErr = "";

        cmd.stdout!.on("data", (newData) => {
            onOut?.(String(newData));
            stdOut += String(newData);
        });

        cmd.stderr!.on("data", (newData) => {
            onErr?.(String(newData));
            stdErr += String(newData);
        });

        cmd.on("close", (code, signal) => {
            terminated = true;

            if (!code) {
                resolve({ stdOut, stdErr, code });
                return;
            }

            reject(new RunError(`Program exited with code ${code}`, {
                stdOut,
                stdErr,
                code,
            }));
        });

        cmd.on("error", () => {
            reject(new Error(`Cant's start program`));
        });
    });

    p.kill = safeKill;

    return p;
};

export type { RunResult, KillFn };
export { run, RunError };
