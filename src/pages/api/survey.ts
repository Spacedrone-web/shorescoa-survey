import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  try {
    const data = await request.formData();

    const get    = (key: string) => (data.get(key) as string | null) ?? '';
    const getInt = (key: string) => {
      const v = parseInt(get(key), 10);
      return isNaN(v) ? null : v;
    };

    const db = getDb();

    await db.execute({
      sql: `INSERT INTO survey_responses (
        arrival_date, departure_date, unit_number,
        q1_purpose,
        q2_registration, q2_packet, q2_concierge, q2_patrol,
        q3_concierge, q3_patrol, q3_cac, q3_maintenance,
        q4_indoorpoolarea, q4_indoorpool, q4_indoorhottub,
        q4_outdoorpoolarea, q4_outdoorpool, q4_outdoorhottub,
        q4_lobby, q4_elevators, q4_restrooms, q4_garage, q4_stairs,
        q5_overall,
        q6_recommend, q6_comments
      ) VALUES (
        ?, ?, ?,
        ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?,
        ?, ?
      )`,
      args: [
        get('arrival_date'), get('departure_date'), get('unit_number'),
        get('q1_purpose'),
        getInt('q2_registration'), getInt('q2_packet'), getInt('q2_concierge'), getInt('q2_patrol'),
        getInt('q3_concierge'), getInt('q3_patrol'), getInt('q3_cac'), getInt('q3_maintenance'),
        getInt('q4_indoorpoolarea'), getInt('q4_indoorpool'), getInt('q4_indoorhottub'),
        getInt('q4_outdoorpoolarea'), getInt('q4_outdoorpool'), getInt('q4_outdoorhottub'),
        getInt('q4_lobby'), getInt('q4_elevators'), getInt('q4_restrooms'), getInt('q4_garage'), getInt('q4_stairs'),
        getInt('q5_overall'),
        get('q6_recommend'), get('q6_comments'),
      ],
    });

    return redirect('/thankyou', 302);
  } catch (err) {
    console.error('Survey submission error:', err);
    return new Response('An error occurred while saving your response. Please try again.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
};