import type { Table as ArrowTable } from "apache-arrow";

const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]);

type ArrowModule = typeof import("apache-arrow");
type WasmTableLike = {
  intoIPCStream(): Uint8Array;
  free(): void;
};

type WriterPropertiesLike = {
  free(): void;
};

type WriterPropertiesBuilderLike = {
  setCompression(value: number): WriterPropertiesBuilderLike;
  build(): WriterPropertiesLike;
};

type ParquetRuntime = {
  default?: (moduleOrPath?: unknown) => Promise<unknown>;
  readParquet(parquetFile: Uint8Array): WasmTableLike;
  writeParquet(
    table: WasmTableLike,
    writerProperties?: WriterPropertiesLike | null
  ): Uint8Array;
  Table: {
    fromIPCStream(buf: Uint8Array): WasmTableLike;
  };
  WriterPropertiesBuilder: new () => WriterPropertiesBuilderLike;
  Compression: {
    SNAPPY: number;
  };
};

type PlainJson =
  | null
  | boolean
  | number
  | string
  | PlainJson[]
  | { [key: string]: PlainJson };

type ScalarColumnType =
  | "float32"
  | "float64"
  | "int64"
  | "utf8";

type ListColumnType =
  | "list<float32>"
  | "list<float64>"
  | "list<int64>"
  | "list<utf8>";

type SupportedColumnType = ScalarColumnType | ListColumnType;

type ColumnSpec = {
  name: string;
  type: SupportedColumnType;
  values: unknown[];
};

let parquetModulesPromise: Promise<{
  arrow: ArrowModule;
  parquet: ParquetRuntime;
}> | null = null;

const shouldUseNodeParquetRuntime = () =>
  typeof process !== "undefined" &&
  typeof process.versions === "object" &&
  process.versions !== null &&
  typeof process.versions.node === "string" &&
  process.versions.node.length > 0;

const importNodeModule = <ModuleType>(specifier: string): Promise<ModuleType> =>
  import(/* @vite-ignore */ specifier) as Promise<ModuleType>;

const initializeNodeParquetRuntime = async (parquet: ParquetRuntime) => {
  const [{ readFile }, { createRequire }] = await Promise.all([
    importNodeModule<typeof import("node:fs/promises")>("node:fs/promises"),
    importNodeModule<typeof import("node:module")>("node:module"),
  ]);
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("parquet-wasm/esm/parquet_wasm_bg.wasm");
  const wasmBuffer = await readFile(wasmPath);
  await parquet.default?.({ module_or_path: wasmBuffer });
};

const loadParquetModules = async () => {
  if (!parquetModulesPromise) {
    parquetModulesPromise = (async () => {
      const arrow = await import("apache-arrow");
      const parquet = (await import("parquet-wasm/esm")) as ParquetRuntime;
      if (shouldUseNodeParquetRuntime()) {
        await initializeNodeParquetRuntime(parquet);
      } else {
        try {
          await parquet.default?.();
        } catch (error) {
          if (
            typeof navigator === "undefined" ||
            !navigator.userAgent.toLowerCase().includes("jsdom")
          ) {
            throw error;
          }
          await initializeNodeParquetRuntime(parquet);
        }
      }
      return { arrow, parquet };
    })();
  }
  return parquetModulesPromise;
};

const ensureSafeNumber = (value: bigint) => {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized)) {
    throw new Error(`Parquet value exceeds safe integer range: ${value.toString()}`);
  }
  return normalized;
};

const normalizeArrowValue = (value: unknown): PlainJson => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    return ensureSafeNumber(value);
  }
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeArrowValue(entry));
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toJSON" in value &&
    typeof value.toJSON === "function"
  ) {
    return normalizeArrowValue(value.toJSON());
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeArrowValue(entry)])
    );
  }
  return String(value);
};

const buildScalarVector = (
  arrow: ArrowModule,
  type: ScalarColumnType,
  values: unknown[]
) => {
  switch (type) {
    case "float32":
      return arrow.vectorFromArray(
        values.map((value) => (typeof value === "number" ? value : Number(value) || 0)),
        new arrow.Float32()
      );
    case "float64":
      return arrow.vectorFromArray(
        values.map((value) => (typeof value === "number" ? value : Number(value) || 0)),
        new arrow.Float64()
      );
    case "int64":
      return arrow.vectorFromArray(
        values.map((value) => BigInt(Math.trunc(typeof value === "number" ? value : Number(value) || 0))),
        new arrow.Int64()
      );
    case "utf8":
      return arrow.vectorFromArray(
        values.map((value) => (value == null ? null : String(value))),
        new arrow.Utf8()
      );
  }
};

const buildListVector = (
  arrow: ArrowModule,
  type: ListColumnType,
  values: unknown[]
) => {
  switch (type) {
    case "list<float32>":
      return arrow.vectorFromArray(
        values.map((value) =>
          Array.isArray(value)
            ? value.map((entry) =>
                typeof entry === "number" ? entry : Number(entry) || 0
              )
            : []
        ),
        new arrow.List(new arrow.Field("item", new arrow.Float32(), true))
      );
    case "list<float64>":
      return arrow.vectorFromArray(
        values.map((value) =>
          Array.isArray(value)
            ? value.map((entry) =>
                typeof entry === "number" ? entry : Number(entry) || 0
              )
            : []
        ),
        new arrow.List(new arrow.Field("item", new arrow.Float64(), true))
      );
    case "list<int64>":
      return arrow.vectorFromArray(
        values.map((value) =>
          Array.isArray(value)
            ? value.map((entry) =>
                BigInt(Math.trunc(typeof entry === "number" ? entry : Number(entry) || 0))
              )
            : []
        ),
        new arrow.List(new arrow.Field("item", new arrow.Int64(), true))
      );
    case "list<utf8>":
      return arrow.vectorFromArray(
        values.map((value) =>
          Array.isArray(value) ? value.map((entry) => String(entry)) : []
        ),
        new arrow.List(new arrow.Field("item", new arrow.Utf8(), true))
      );
  }
};

const buildArrowTable = (arrow: ArrowModule, columns: ColumnSpec[]): ArrowTable => {
  const vectors = Object.fromEntries(
    columns.map((column) => {
      const vector = column.type.startsWith("list<")
        ? buildListVector(arrow, column.type as ListColumnType, column.values)
        : buildScalarVector(arrow, column.type as ScalarColumnType, column.values);
      return [column.name, vector];
    })
  );
  return new arrow.Table(vectors);
};

export const isParquetBytes = (value: Uint8Array) =>
  value.length >= PARQUET_MAGIC.length * 2 &&
  PARQUET_MAGIC.every((byte, index) => value[index] === byte) &&
  PARQUET_MAGIC.every(
    (byte, index) => value[value.length - PARQUET_MAGIC.length + index] === byte
  );

export const readParquetRows = async <Row extends Record<string, unknown>>(
  parquetBytes: Uint8Array
): Promise<Row[]> => {
  const { arrow, parquet } = await loadParquetModules();
  const wasmTable = parquet.readParquet(parquetBytes);
  const arrowTable = arrow.tableFromIPC(wasmTable.intoIPCStream());
  return Array.from({ length: arrowTable.numRows }, (_, rowIndex) =>
    normalizeArrowValue(arrowTable.get(rowIndex)) as Row
  );
};

export const writeParquetFile = async (columns: ColumnSpec[]) => {
  const { arrow, parquet } = await loadParquetModules();
  const arrowTable = buildArrowTable(arrow, columns);
  const wasmTable = parquet.Table.fromIPCStream(arrow.tableToIPC(arrowTable, "stream"));
  const writerProperties = new parquet.WriterPropertiesBuilder()
    .setCompression(parquet.Compression.SNAPPY)
    .build();
  return parquet.writeParquet(wasmTable, writerProperties);
};
