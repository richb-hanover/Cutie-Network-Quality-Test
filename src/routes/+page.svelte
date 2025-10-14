
<script lang="ts">
  import Intro from '$lib/Intro.svelte';
  let user = 'Rich';
  let clicks = 5;
</script>

<Intro name={user} count={clicks} />

<h1>Welcome to SvelteKit</h1>
<p>Visit <a href="https://svelte.dev/docs/kit">svelte.dev/docs/kit</a> to read the documentation</p>
