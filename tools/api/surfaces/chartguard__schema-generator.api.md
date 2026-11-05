## @chartguard/schema-generator

### LIBRARIES
LIBRARIES: string[]

### LOCAL_ARTIFACTS
LOCAL_ARTIFACTS: "node_modules/.cache/chartguard"

### UpstreamError
class UpstreamError extends Error {
}

### buildLocalSchema
function buildLocalSchema(root: string, library: string): {
    path: string;
    version: string;
    digest: string;
    integrity: string;
};

### compilerPin
function compilerPin(): any;

### contentIntegrity
function contentIntegrity(directory: any): string;

### digestOf
function digestOf(artifact: any): string;

### generateArtifact
function generateArtifact(root: any, library: any, pin: any): {
    artifact: {
        [k: string]: any;
    };
    text: string;
};

### installedUpstream
function installedUpstream(root: any, library: any): any;

### isRedistributable
function isRedistributable(pin: any): boolean;

### localSchemaPath
function localSchemaPath(root: string, library: string, version: string): string;

### omit
function omit(object: any, keys: any): {
    [k: string]: any;
};

### pinOf
function pinOf(library: any): any;

### serialize
function serialize(artifact: any): string;

### sourceDirectory
function sourceDirectory(root: any, packageName: any): string;

### untracedFacts
function untracedFacts(root: any, artifact: any): string[];

### verifiedCompiler
function verifiedCompiler(version: any): any;

### verifiedUpstream
function verifiedUpstream(root: any, library: any): any;

### withDigest
function withDigest(artifact: any): {
    [k: string]: any;
};

## @chartguard/schema-generator/paths

### LOCAL_ARTIFACTS
LOCAL_ARTIFACTS: "node_modules/.cache/chartguard"

### localSchemaPath
function localSchemaPath(root: string, library: string, version: string): string;

### otherBuild
function otherBuild(artifact: unknown): string | undefined;
