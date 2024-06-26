import { PluginSettings } from "../settings/settings";
import {
    S3Client,
    GetObjectCommand,
    ListObjectVersionsCommand,
    ListObjectVersionsCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import AwsCredentialProvider from "../aws/awsCredentialProvider";
import AwsCredential from "../aws/awsCredential";
import Config from "../config";
import S3LinkPlugin from "../main";
import { PluginState } from "../pluginState";
import { sendNotification } from "../ui/notification";
import { isPluginReadyState } from "../settings/settings";
import { Readable } from "stream";
import DownloadManager from "./downloadManager";

export class Client {
    private readonly moduleName = "Client";
    private s3Client: S3Client | null;
    private awsCredentialProvider = new AwsCredentialProvider();
    private settings: PluginSettings;
    private plugin: S3LinkPlugin;

    constructor(settings: PluginSettings, plugin: S3LinkPlugin) {
        this.settings = settings;
        this.plugin = plugin;
    }

    private async createS3Client() {
        if (isPluginReadyState(this.settings)) {
            if (
                this.settings.profile !== "" &&
                this.settings.profile !== Config.AWS_PROFILE_NAME_NONE
            ) {
                const credentials: AwsCredential | null =
                    await this.awsCredentialProvider.getAwsCredentials(
                        this.settings.profile
                    );

                if (credentials) {
                    this.s3Client = new S3Client({
                        endpoint: this.settings.endpoint,
                        region: this.settings.region,
                        credentials: {
                            accessKeyId: credentials.accessKeyId,
                            secretAccessKey: credentials.secretAccessKey,
                        },
                    });
                } else {
                    /**
                     * If the credentials are not found, set the plugin state to error and reset the profile setting.
                     * This case can happen if the user had a profile set and then deleted the profile from the credentials file.
                     */
                    this.plugin.setState(PluginState.ERROR);
                    this.settings.profile = "";
                    await this.plugin.saveSettings();
                    sendNotification(
                        "Failed to retrieve credentials for profile - Please check Settings"
                    );
                    this.s3Client = null;
                }
            } else {
                this.s3Client = new S3Client({
                    endpoint: this.settings.endpoint,
                    region: this.settings.region,
                    credentials: {
                        accessKeyId: this.settings.accessKeyId,
                        secretAccessKey: this.settings.secretAccessKey,
                    },
                });
            }
        } else {
            this.s3Client = null;
        }
    }

    /**
     * Allows for the reinitialization of the S3Client with new settings.
     *
     * @param settings PluginSettings containing the new settings
     */
    public initializeS3Client(settings: PluginSettings) {
        this.settings = settings;
        this.createS3Client();
    }

    /**
     * Retrievees the latest versionId for the given objectKey.
     *
     * @param objectKey The objectKey of the object to retrieve the latest versionId for
     *
     * @returns Promise<string | undefined> containing the latest versionId or undefined if the object does not exist
     */
    public async getLatestObjectVersion(
        objectKey: string
    ): Promise<string | undefined> {
        try {
            const response = await this.getObjectMetadata(objectKey);
            const VERSION_LATEST = 0;

            // Filter the object versions to only contain the exact objectKey
            const exactFilteredVersion =
                response.Versions?.filter(
                    (version) => version.Key === objectKey
                ) || [];

            if (
                exactFilteredVersion != null &&
                exactFilteredVersion.length > 0
            ) {
                const versionId =
                    exactFilteredVersion[VERSION_LATEST].VersionId;
                console.debug(
                    `${this.moduleName}: Retrieved versionId ${versionId} for object ${objectKey}`
                );

                return versionId;
            }
        } catch (error) {
            console.error(
                `${this.moduleName}: Failed to retrieve object versionId`,
                error
            );

            throw error;
        }
    }

    private async getObjectMetadata(
        objectKey: string
    ): Promise<ListObjectVersionsCommandOutput> {
        if (!this.s3Client) {
            throw new Error("S3Client not initialized");
        }

        const command = new ListObjectVersionsCommand({
            Bucket: this.settings.bucketName,
            Prefix: objectKey,
        });
        const response = await this.s3Client.send(command);

        console.debug(
            `${this.moduleName}: getObjectMetadata response`,
            response
        );

        return response;
    }

    public async getObject(
        objectKey: string,
        versionId: string
    ): Promise<Readable> {
        if (!this.s3Client) {
            throw new Error("S3Client not initialized");
        }

        const downloadManager = DownloadManager.getInstance();

        try {
            downloadManager.addNewDownload(objectKey, versionId);

            const command = new GetObjectCommand({
                Bucket: this.settings.bucketName,
                Key: objectKey,
            });
            const response = await this.s3Client.send(command);

            if (response.Body) {
                downloadManager.setRunningState(objectKey, versionId);

                const stream = this.browserStreamToReadable(
                    response.Body as ReadableStream
                );

                stream.on("end", () => {
                    downloadManager.setCompletedState(objectKey, versionId);
                });

                return stream;
            } else {
                throw new Error(
                    `Failed to retrieve object ${objectKey} from S3`
                );
            }
        } catch (error) {
            downloadManager.setErrorState(objectKey, versionId);
            console.error("Error retrieving object from S3", error);
            throw error;
        }
    }

    private browserStreamToReadable(browserStream: ReadableStream): Readable {
        const reader = browserStream.getReader();
        return new Readable({
            async read() {
                const result = await reader.read();
                if (result.done) {
                    this.push(null);
                } else {
                    this.push(Buffer.from(result.value));
                }
            },
        });
    }

    public async getSignedUrlForObject(objectKey: string): Promise<string> {
        console.debug(
            `${this.moduleName}::getSignedUrlForObject - Retrieving signed URL for object ${objectKey}`
        );

        if (!this.s3Client) {
            throw new Error("S3Client not initialized");
        }

        try {
            // Create a GetObjectCommand with the bucket and object key
            const command = new GetObjectCommand({
                Bucket: this.settings.bucketName,
                Key: objectKey,
            });

            // Generate the signed URL
            const signedUrl = await getSignedUrl(this.s3Client, command, {
                expiresIn: Config.S3_SIGNED_LINK_EXPIRATION_TIME_SECONDS,
            });

            return signedUrl;
        } catch (error) {
            console.error("Error generating signed URL:", error);
            throw error;
        }
    }
}
