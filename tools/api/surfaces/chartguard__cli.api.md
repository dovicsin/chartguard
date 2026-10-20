## @chartguard/cli

### Io
interface Io {
    readonly out: (line: string) => void;
    readonly err: (line: string) => void;
}

### main
function main(argv?: readonly string[], io?: Io): Promise<number>;
