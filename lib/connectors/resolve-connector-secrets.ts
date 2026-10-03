import { ConnectorConfig } from "@/lib/types";

const SECRET_REFERENCE_REGEX = /^env\.([A-Za-z0-9_]+)$/;
const INPUT_PLACEHOLDER_REGEX = /\$\{input:([A-Za-z0-9_]+)\}/g;
const SIMPLE_PLACEHOLDER_REGEX = /\$\{([A-Za-z0-9_]+)\}/g;

function resolveEnvValue(
  value: string,
  secretMap: Record<string, string>,
): string {
  let resolved = value;
  resolved = resolved.replace(INPUT_PLACEHOLDER_REGEX, (token, secretName) => {
    return secretMap[secretName] ?? token;
  });
  resolved = resolved.replace(SIMPLE_PLACEHOLDER_REGEX, (token, secretName) => {
    return secretMap[secretName] ?? token;
  });

  const match = resolved.trim().match(SECRET_REFERENCE_REGEX);
  if (!match) return resolved;

  const secretName = match[1];
  return secretMap[secretName] ?? resolved;
}

export function resolveConnectorSecrets(
  servers: ConnectorConfig[],
  secretMap: Record<string, string>,
): ConnectorConfig[] {
  if (servers.length === 0 || Object.keys(secretMap).length === 0) {
    return servers;
  }

  return servers.map((server) => {
    if (!server.headers) return server;

    let hasChanges = false;
    const resolvedHeaders = server.headers
      ? Object.fromEntries(
          Object.entries(server.headers).map(([key, value]) => {
            const resolvedValue = resolveEnvValue(value, secretMap);
            if (resolvedValue !== value) {
              hasChanges = true;
            }
            return [key, resolvedValue];
          }),
        )
      : undefined;

    if (!hasChanges) return server;

    return {
      ...server,
      ...(resolvedHeaders ? { headers: resolvedHeaders } : {}),
    };
  });
}
