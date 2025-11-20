<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.ico';
	import { onMount } from 'svelte';
	import { disconnect } from './+page.svelte';
	let { children } = $props();

	onMount(() => {
		// const handler = (event: BeforeUnloadEvent) => {
		// 	event.preventDefault();
		// 	// event.returnValue = ''; // triggers the prompt
		// };

		window.addEventListener('beforeunload', disconnect());
		return () => window.removeEventListener('beforeunload', handler);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}
