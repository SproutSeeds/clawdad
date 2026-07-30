export function redactSensitiveText(value) {
  return String(value || "")
    .replace(
      /(authorization\s*:\s*(?:bearer|basic)\s+)[^\s"'\\]+/giu,
      "$1[REDACTED]",
    )
    .replace(
      /(\b--(?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password|secret|token)(?:=|\s+))(['"]?)([^\s'"]+)\2/giu,
      "$1$2[REDACTED]$2",
    )
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_KEY|PRIVATE_KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*=)(['"]?)([^\s'"]+)\2/gu,
      "$1$2[REDACTED]$2",
    )
    .replace(
      /([?&](?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password|secret|token)=)[^&#\s"']+/giu,
      "$1[REDACTED]",
    )
    .replace(
      /(https?:\/\/)[^/\s:@]+:[^/@\s]+@/giu,
      "$1[REDACTED]@",
    )
    .replace(
      /\b(?:art_v1_|github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]{16,}\b/gu,
      "[REDACTED]",
    );
}

export function redactSensitiveValue(value) {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactSensitiveValue(entry)]),
    );
  }
  return value;
}
