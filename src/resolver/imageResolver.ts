import Config from "../config";
import Resolver from "./resolver";

export default class ImageResolver extends Resolver {
    private readonly moduleName = "ImageResolver";
    targetElement = "img";

    constructor() {
        super();
    }

    /**
     * Resolve all image tags that contain a link to an S3 object in the plugins expected format.
     *
     * @param element An HTMLElement containing the rendered markdown content
     *
     * @returns two separate maps for objectKeys and signObjectKeys
     */
    public resolveHtmlElement(element: HTMLElement): {
        objectKeys: Map<string, HTMLElement[]>;
        signObjectKeys: Map<string, HTMLElement[]>;
    } {
        console.debug(
            `${this.moduleName}::resolveHtmlElement - Processing rendered html content`
        );

        const imageElements = element.querySelectorAll(
            this.targetElement
        ) as NodeListOf<HTMLImageElement>;
        this.clearObjectKeys();
        this.clearSignObjectKeys();

        if (imageElements.length == 0) {
            console.debug(
                `${this.moduleName} - Rendered markdown content does not contain any image tags, aborting...`
            );

            return {
                objectKeys: this.objectKeys,
                signObjectKeys: this.signObjectKeys,
            };
        }

        imageElements.forEach((imageElement) => {
            const parts = imageElement.src.split(Config.S3_LINK_SPLITTER);

            if (parts[this.s3LinkLeftPart] == Config.S3_LINK_PREFIX) {
                console.debug(
                    `${this.moduleName} - ImageResolver found link:`,
                    imageElement.src
                );

                this.addObjectKey(parts[this.s3LinkRightPart], imageElement);
            } else if (
                parts[this.s3LinkLeftPart] == Config.S3_SIGNED_LINK_PREFIX
            ) {
                console.debug(
                    `${this.moduleName} - ImageResolver found sign link:`,
                    imageElement.src
                );

                this.addSignObjectKey(
                    parts[this.s3LinkRightPart],
                    imageElement
                );
            }
        });

        return {
            objectKeys: this.objectKeys,
            signObjectKeys: this.signObjectKeys,
        };
    }
}