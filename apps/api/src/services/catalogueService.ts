import { randomUUID } from 'node:crypto';
import { type Database, withTenant } from '@invoice/database';
import { HttpError } from '../errors';

export function catalogueService(db: Database) {
  return {
    // Customers
    async listCustomers(vendorId: string, q?: string, status?: string) {
      return withTenant(db, vendorId, async client => {
        let sql = 'SELECT * FROM customers WHERE vendor_id=$1';
        const params: any[] = [vendorId];
        if (status) {
          params.push(status);
          sql += ` AND status=$${params.length}`;
        }
        if (q) {
          params.push(`%${q}%`);
          sql += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length})`;
        }
        sql += ' ORDER BY created_at DESC';
        return (await client.query(sql, params)).rows;
      });
    },

    async getCustomer(vendorId: string, id: string) {
      return withTenant(db, vendorId, async client => {
        const row = (await client.query('SELECT * FROM customers WHERE id=$1 AND vendor_id=$2', [id, vendorId])).rows[0];
        if (!row) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
        return row;
      });
    },

    async createCustomer(vendorId: string, input: any) {
      return withTenant(db, vendorId, async client => {
        const id = randomUUID();
        const row = (await client.query(
          `INSERT INTO customers(id,vendor_id,name,email,phone,address,gstin)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [id, vendorId, input.name, input.email, input.phone ?? null, JSON.stringify(input.address), input.gstin ?? null]
        )).rows[0];
        return row;
      });
    },

    async patchCustomer(vendorId: string, id: string, patch: any, version: number) {
      return withTenant(db, vendorId, async client => {
        const curr = (await client.query('SELECT version FROM customers WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!curr) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
        if (curr.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Customer was modified.');

        const row = (await client.query(
          `UPDATE customers SET
             name=coalesce($3,name),
             email=coalesce($4,email),
             phone=coalesce($5,phone),
             address=case when $6::jsonb is not null then $6::jsonb else address end,
             gstin=coalesce($7,gstin),
             version=version+1
           WHERE id=$1 AND vendor_id=$2 RETURNING *`,
          [
            id,
            vendorId,
            patch.name,
            patch.email,
            patch.phone,
            patch.address ? JSON.stringify(patch.address) : null,
            patch.gstin,
          ]
        )).rows[0];
        return row;
      });
    },

    async archiveCustomer(vendorId: string, id: string, version: number) {
      return withTenant(db, vendorId, async client => {
        const curr = (await client.query('SELECT version FROM customers WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!curr) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
        if (curr.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Customer was modified.');
        return (await client.query("UPDATE customers SET status='ARCHIVED',version=version+1 WHERE id=$1 AND vendor_id=$2 RETURNING *", [id, vendorId])).rows[0];
      });
    },

    async getCustomerOptions(vendorId: string, q?: string) {
      return withTenant(db, vendorId, async client => {
        let sql = "SELECT id,name,email FROM customers WHERE vendor_id=$1 AND status='ACTIVE'";
        const params: any[] = [vendorId];
        if (q) {
          params.push(`%${q}%`);
          sql += ` AND name ILIKE $${params.length}`;
        }
        sql += ' ORDER BY name ASC LIMIT 50';
        return (await client.query(sql, params)).rows;
      });
    },

    // Catalogue Items
    async listCatalogueItems(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query(
          `SELECT ci.*, tp.name as tax_profile_name, tp.components as tax_components
           FROM catalogue_items ci
           LEFT JOIN tax_profiles tp ON ci.tax_profile_id=tp.id
           WHERE ci.vendor_id=$1
           ORDER BY ci.created_at DESC`,
          [vendorId]
        )).rows;
      });
    },

    async createCatalogueItem(vendorId: string, input: any) {
      return withTenant(db, vendorId, async client => {
        const id = randomUUID();
        return (await client.query(
          `INSERT INTO catalogue_items(id,vendor_id,sku,name,item_type,unit,unit_price,tax_profile_id,hsn_sac)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [id, vendorId, input.sku ?? null, input.name, input.item_type, input.unit, input.unit_price, input.tax_profile_id ?? null, input.hsn_sac ?? null]
        )).rows[0];
      });
    },

    async patchCatalogueItem(vendorId: string, id: string, patch: any, version: number) {
      return withTenant(db, vendorId, async client => {
        const curr = (await client.query('SELECT version FROM catalogue_items WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!curr) throw new HttpError(404, 'ITEM_NOT_FOUND', 'Item not found.');
        if (curr.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Item was modified.');

        return (await client.query(
          `UPDATE catalogue_items SET
             sku=coalesce($3,sku),
             name=coalesce($4,name),
             item_type=coalesce($5,item_type),
             unit=coalesce($6,unit),
             unit_price=coalesce($7,unit_price),
             tax_profile_id=coalesce($8,tax_profile_id),
             hsn_sac=coalesce($9,hsn_sac),
             version=version+1
           WHERE id=$1 AND vendor_id=$2 RETURNING *`,
          [id, vendorId, patch.sku, patch.name, patch.item_type, patch.unit, patch.unit_price, patch.tax_profile_id, patch.hsn_sac]
        )).rows[0];
      });
    },

    async archiveCatalogueItem(vendorId: string, id: string, version: number) {
      return withTenant(db, vendorId, async client => {
        const curr = (await client.query('SELECT version FROM catalogue_items WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!curr) throw new HttpError(404, 'ITEM_NOT_FOUND', 'Item not found.');
        if (curr.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Item was modified.');
        return (await client.query('UPDATE catalogue_items SET active=false,version=version+1 WHERE id=$1 AND vendor_id=$2 RETURNING *', [id, vendorId])).rows[0];
      });
    },

    async getItemOptions(vendorId: string, q?: string) {
      return withTenant(db, vendorId, async client => {
        let sql = `SELECT ci.id,ci.name,ci.unit,ci.unit_price,tp.components as tax_components
                   FROM catalogue_items ci
                   LEFT JOIN tax_profiles tp ON ci.tax_profile_id=tp.id
                   WHERE ci.vendor_id=$1 AND ci.active=true`;
        const params: any[] = [vendorId];
        if (q) {
          params.push(`%${q}%`);
          sql += ` AND ci.name ILIKE $${params.length}`;
        }
        sql += ' ORDER BY ci.name ASC LIMIT 50';
        return (await client.query(sql, params)).rows;
      });
    },

    // Tax Profiles
    async listTaxProfiles(vendorId: string) {
      return withTenant(db, vendorId, async client => {
        return (await client.query('SELECT * FROM tax_profiles WHERE vendor_id=$1 ORDER BY created_at DESC', [vendorId])).rows;
      });
    },

    async createTaxProfile(vendorId: string, input: any) {
      return withTenant(db, vendorId, async client => {
        const id = randomUUID();
        return (await client.query(
          `INSERT INTO tax_profiles(id,vendor_id,name,mode,components,calculation_version)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [id, vendorId, input.name, input.mode, JSON.stringify(input.components), input.calculation_version ?? 'v1']
        )).rows[0];
      });
    },

    async patchTaxProfile(vendorId: string, id: string, patch: any, version: number) {
      return withTenant(db, vendorId, async client => {
        const curr = (await client.query('SELECT version FROM tax_profiles WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!curr) throw new HttpError(404, 'TAX_PROFILE_NOT_FOUND', 'Tax profile not found.');
        if (curr.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Tax profile was modified.');

        return (await client.query(
          `UPDATE tax_profiles SET
             name=coalesce($3,name),
             mode=coalesce($4,mode),
             components=case when $5::jsonb is not null then $5::jsonb else components end,
             version=version+1
           WHERE id=$1 AND vendor_id=$2 RETURNING *`,
          [id, vendorId, patch.name, patch.mode, patch.components ? JSON.stringify(patch.components) : null]
        )).rows[0];
      });
    },

    async archiveTaxProfile(vendorId: string, id: string, version: number) {
      return withTenant(db, vendorId, async client => {
        const curr = (await client.query('SELECT version FROM tax_profiles WHERE id=$1 AND vendor_id=$2 FOR UPDATE', [id, vendorId])).rows[0];
        if (!curr) throw new HttpError(404, 'TAX_PROFILE_NOT_FOUND', 'Tax profile not found.');
        if (curr.version !== version) throw new HttpError(409, 'CONCURRENCY_CONFLICT', 'Tax profile was modified.');
        return (await client.query('UPDATE tax_profiles SET active=false,version=version+1 WHERE id=$1 AND vendor_id=$2 RETURNING *', [id, vendorId])).rows[0];
      });
    },
  };
}
