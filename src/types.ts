export type FrontendPublishMode = 'bundle' | 'ssg';

export interface FrontendCommandOptions {
    readonly workspaceRoot: string;
    readonly changedFile?: string;
    readonly watch?: boolean;
    readonly publishMode?: FrontendPublishMode;
}

export interface FrontendConfig {
    readonly version: 1;
    readonly paths: FrontendPathConfig;
    readonly features: FrontendFeatureFlags;
}

export interface EnableFlags {
    readonly spa?: boolean;
    readonly clientNav?: boolean;
    readonly backend?: boolean;
    readonly search?: boolean;
}

export interface FrontendPathConfig {
    readonly workspace: string;
    readonly src: {
        readonly root: string;
        readonly frontend: string;
        readonly app: string;
        readonly pages: string;
        readonly content: string;
        readonly images: string;
        readonly fonts: string;
        readonly media: string;
    };
    readonly build: {
        readonly root: string;
        readonly frontend: string;
        readonly app: string;
        readonly pages: string;
        readonly content: string;
        readonly images: string;
        readonly fonts: string;
        readonly media: string;
    };
    readonly dist: {
        readonly root: string;
        readonly frontend: string;
        readonly app: string;
        readonly pages: string;
        readonly content: string;
        readonly images: string;
        readonly fonts: string;
        readonly media: string;
    };
}

export interface FrontendFeatureFlags {
    readonly htmlSecurity: boolean;
    readonly imageOptimization: boolean;
    readonly precompression: boolean;
}

export interface AddPageCommandOptions extends FrontendCommandOptions {
    readonly pageName: string;
    readonly ssg?: boolean;
}
