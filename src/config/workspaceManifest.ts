export type RenderMode = 'ssg' | 'ssr' | 'spa';

export interface WorkspaceModuleView {
    readonly name?: string;
    readonly path?: string;
    readonly renderMode?: RenderMode;
    readonly staticPaths?: readonly string[];
}

export interface WorkspaceModuleRouteGuard {
    readonly renderMode?: unknown;
    readonly staticPaths?: unknown;
    readonly ssg?: unknown;
}

export interface WorkspaceModuleConfig {
    readonly views?: readonly WorkspaceModuleView[];
    readonly routes?: readonly WorkspaceModuleRouteGuard[];
}

export interface WorkspacePackageJson {
    readonly name?: string;
    readonly webstir?: {
        readonly mode?: string;
        readonly moduleManifest?: WorkspaceModuleConfig;
    };
}
