const repo = Deno.args[0] || "denoland/deno";
const pullNumber = Deno.args[1] || "1";
const token = Deno.env.get("GITHUB_TOKEN");

async function generateComment() {
    const comment = {
        body: `Hello, world!`,
    };
    const response = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${pullNumber}/reviews`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `token ${token}`,
            },
            body: JSON.stringify(comment),
        },
    );
    return response.json();
}
