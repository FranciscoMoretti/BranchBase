export class ProductCatalogError extends Error {
  readonly code = "invalid_product_catalog";
  readonly file: string;
  readonly cause: unknown;

  constructor(file: string, cause: unknown) {
    super(
      `BranchBase could not read a valid project catalog at ${file}. ` +
        "The file was left unchanged; repair or restore it before retrying."
    );
    this.file = file;
    this.cause = cause;
    this.name = "ProductCatalogError";
  }
}
