import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;

  //
  // 1️⃣ Same-Day Check-ins (excluding Self Managed)
  //
  const sameDay = await db.prepare(`
    SELECT 
      invitedBy_companyName AS manager,
      COUNT(*) AS same_day_checkins
    FROM guests
    WHERE arrival = DATE('now')
      AND created = DATE('now')
      AND departure >= DATE('now')
      AND invitedBy_companyName NOT LIKE '%Self Managed%'
    GROUP BY manager
    ORDER BY same_day_checkins DESC
    LIMIT 5;
  `).all();

  //
  // 2️⃣ Total Occupancy (current units only)
  //
  const occupancy = await db.prepare(`
    WITH rented AS (
      SELECT COUNT(DISTINCT unit) AS rented_units
      FROM guests
      WHERE arrival <= DATE('now')
        AND departure >= DATE('now')
    ),
    guests_today AS (
      SELECT COUNT(*) AS est_guests
      FROM guests
      WHERE arrival <= DATE('now')
        AND departure >= DATE('now')
    )
    SELECT
      rented.rented_units,
      625 - rented.rented_units AS available_units,
      guests_today.est_guests
    FROM rented, guests_today;
  `).first();

  //
  // 3️⃣ Manager Occupancy % (≥ 6 units, top 5)
  //
  const managerOccupancy = await db.prepare(`
    WITH managed AS (
      SELECT 
        invitedBy_companyName AS manager,
        COUNT(DISTINCT unit) AS total_units
      FROM guests
      WHERE invitedBy_companyName NOT LIKE '%Self Managed%'
      GROUP BY invitedBy_companyName
      HAVING total_units >= 6
    )
    SELECT
      managed.manager,
      managed.total_units,
      (
        SELECT COUNT(DISTINCT unit)
        FROM guests
        WHERE arrival <= DATE('now')
          AND departure >= DATE('now')
          AND invitedBy_companyName = managed.manager
      ) AS rented_today,
      ROUND(
        (
          SELECT COUNT(DISTINCT unit)
          FROM guests
          WHERE arrival <= DATE('now')
            AND departure >= DATE('now')
            AND invitedBy_companyName = managed.manager
        ) * 1.0 / managed.total_units * 100,
        2
      ) AS occupancy_pct
    FROM managed
    ORDER BY occupancy_pct DESC
    LIMIT 5;
  `).all();

  return new Response(
    JSON.stringify({
      sameDay,
      occupancy,
      managerOccupancy
    }),
    { status: 200 }
  );
};
