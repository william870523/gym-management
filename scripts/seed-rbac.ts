/**
 * LEGACY_RBAC_SCRIPT_DISABLED
 *
 * El seed anterior inventaba puestos y acciones incompatibles con el contrato
 * canónico. Se conserva el archivo para fallar de forma segura ante
 * invocaciones antiguas.
 */
throw new Error(
  "LEGACY_RBAC_SCRIPT_DISABLED: use `bun run migrate:roles-global` with " +
    "ROLES_GLOBAL_BACKUP_PATH pointing to a current MariaDB dump.",
);
