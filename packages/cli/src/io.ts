/** Where the CLI writes: `out` for results (stdout), `err` for messages (stderr), one line per call. */
export interface Io {
	readonly out: (line: string) => void;
	readonly err: (line: string) => void;
}

export const processIo: Io = {
	out: (line) => process.stdout.write(`${line}\n`),
	err: (line) => process.stderr.write(`${line}\n`)
};
