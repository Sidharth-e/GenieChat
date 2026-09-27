import "server-only";
import { config } from "@/lib/config";
import {
  createStorageClients,
  deleteObject as deleteObjectCore,
  ensureBuckets as ensureBucketsCore,
  getObject as getObjectCore,
  getObjectAsBase64 as getObjectAsBase64Core,
  getObjectAsBuffer as getObjectAsBufferCore,
  presignGet as presignGetCore,
  putObject as putObjectCore,
} from "./s3-core";
import type { ServerActionResponse } from "@/lib/types";
import type { StorageBucket } from "@/constants/storage";
import type { StorageRef } from "./ref";

/**
 * The one place `config.storage` meets the storage core.
 *
 * Built at module load rather than per call, so a blank `S3_ENDPOINT` or
 * missing credentials resolve once into `null` clients that every operation
 * turns into NOT_CONFIGURED. Every application file imports the bound wrappers
 * below and never sees the clients.
 */
const clients = createStorageClients({
  endpoint: config.storage.endpoint,
  publicEndpoint: config.storage.publicEndpoint,
  region: config.storage.region,
  accessKeyId: config.storage.accessKeyId,
  secretAccessKey: config.storage.secretAccessKey,
  forcePathStyle: config.storage.forcePathStyle,
});

export const putObject = (
  bucket: StorageBucket,
  key: string,
  body: Buffer,
): Promise<ServerActionResponse<StorageRef>> =>
  putObjectCore(clients, bucket, key, body);

export const deleteObject = (
  ref: StorageRef,
): Promise<ServerActionResponse<boolean>> => deleteObjectCore(clients, ref);

export const getObject = (
  ref: StorageRef,
): Promise<ServerActionResponse<NodeJS.ReadableStream>> =>
  getObjectCore(clients, ref);

export const getObjectAsBuffer = (
  ref: StorageRef,
): Promise<ServerActionResponse<Buffer>> =>
  getObjectAsBufferCore(clients, ref);

export const getObjectAsBase64 = (
  ref: StorageRef,
): Promise<ServerActionResponse<string>> =>
  getObjectAsBase64Core(clients, ref);

export const presignGet = (
  ref: StorageRef,
  ttlSeconds: number,
): Promise<string> => presignGetCore(clients, ref, ttlSeconds);

export const ensureBuckets = (): Promise<
  ServerActionResponse<StorageBucket[]>
> => ensureBucketsCore(clients);
