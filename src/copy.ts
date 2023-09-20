import { stat } from "fs/promises";

import { Timeout } from "oop-timers";

import type { KillFn, RunResult } from "./utils/run.promise.js";

import { run } from "./utils/run.promise.js";

type Options = {
    /**
     * Rate limit in bytes per second.
     */
    rateLimit?: number;
    /**
     * Timeout in milliseconds. Must be >= 3000.
     */
    timeout?: number;
};

type ProgressData = {
    bytes: number;
    percent: number;
};

type TimeoutData = {
    bytes: number;
    percent: number;
    time: number;
    count: number;
};

type Callbacks = {
    onProgress?: (data: ProgressData) => void;
    onTimeout?: (data: TimeoutData) => void;
};

type ResultStats = {
    bytes: number;
    time: number;
};

const MIN_TIMEOUT = 30;

/**
 * Copies a file from source to destination with progress reporting. It requires `pv` to be installed.
 * Call `abort` on the returned promise to abort the copy.
 *
 * The timeout option does not stop the copy; it only notifies you about progress being stale. It's up to you to abort.
 * The timeout is reset on every progress event, so if the copy process continues and gets stuck again, you will be
 * notified again.
 *
 * @param source - source file path
 * @param destination - destination path
 * @param options - options, you can limit the rate of the copy and set a timeout
 * @param callbacks - callbacks for progress and timeout
 */
const copy = ( // eslint-disable-line max-lines-per-function
    source: string, destination: string, options?: Options | undefined | null, callbacks?: Callbacks,
): Promise<ResultStats> & { abort: () => void } => {
    if (options?.timeout && options.timeout < MIN_TIMEOUT) {
        throw new Error("Timeout must be >= 3000");
    }

    let p: ReturnType<typeof run> | undefined;

    const start = Date.now();
    let kill = false;

    // @ts-expect-error can't do anything about it
    const pr: Promise<ResultStats> & { abort: () => void } = stat(source).then(info => {
        if (kill) {
            return;
        }

        let lastBytes = 0,
            timeouts = 0;

        const timeout = new Timeout(() => {
            timeouts++;

            callbacks?.onTimeout?.({
                bytes: lastBytes,
                // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                percent: (lastBytes / info.size) * 100,
                time: Date.now() - start,
                count: timeouts,
            });
        }, options?.timeout ?? 0, Boolean(options?.timeout && callbacks?.onTimeout));

        p = run("pv", [
            "--numeric", // only output numbers
            "--bytes", // always output bytes
            ...(options?.rateLimit ? ["--rate-limit", String(options.rateLimit)] : []),
            source,
            ">",
            destination,
        ], {
            onErr: (s) => {
                const n = Number(s.trim());
                if (!Number.isNaN(n) && lastBytes !== n) {
                    timeout.start();
                    lastBytes = n;
                    callbacks?.onProgress?.({
                        bytes: n,
                        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                        percent: (n / info.size) * 100,
                    });
                }
            },
        }, { shell: true });

        p.finally(() => {
            timeout.stop();
        }).catch(() => null);

        // @ts-expect-error can't do anything about it
        const pr: Promise<RunResult> & { kill: KillFn } = p.then(() => {
            const end = Date.now();
            return {
                bytes: info.size,
                time: end - start,
            };
        });
        pr.kill = p.kill;

        return pr;
    });

    pr.abort = () => {
        kill = true;
        p?.kill("SIGINT");
    };

    return pr;
};

export type { ProgressData };

export { copy };
