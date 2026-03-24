// Ingest transcripts for lessons 1 and 2, both locally and remote!

const lessons = ["lesson-1", "lesson-2"];
const endpoints = [
    "http://127.0.0.1:8787/api/admin/generate-transcript",
    "https://dbportfolios-backend.blr-bull.workers.dev/api/admin/generate-transcript"
];

async function ingest() {
    for (const endpoint of endpoints) {
        console.log(`\n\n=== Hitting Environment: ${endpoint} ===`);
        for (const lesson of lessons) {
            console.log(`[${lesson}] Requesting...`);
            try {
                const res = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ lessonId: lesson })
                });

                if (!res.ok) {
                    const err = await res.text();
                    console.log(`[${lesson}] Error (${res.status}):`, err);
                } else {
                    const data = await res.json();
                    console.log(`[${lesson}] Success:`, data);
                }
            } catch (e) {
                console.log(`[${lesson}] Network/Fetch Error:`, e.message);
            }
        }
    }
}

ingest();
