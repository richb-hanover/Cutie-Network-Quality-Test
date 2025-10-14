<!-- src/lib/Intro.svelte -->
<script lang="ts">
	// export let title: string = 'Welcome';
	// export let message: string = 'This is the intro section.';
</script>

<section class="intro">
	<script src="index.js"></script>
	<h1>
		NST Network Stability Test<br /><small><i>(v0.0.1)</i></small>
	</h1>
	<p id="descriptionMessage"></p>
	<p>Please click on the <b>Start button</b> to begin running this test.</p>

	<button>Start</button>
	<button id="stopButton" disabled="">Stop</button>
	<button id="saveButton" disabled="">Save as image</button>

	<p id="summaryMessage"></p>
	<p id="divTag"></p>
	<p id="overallMessage"></p>
	<canvas id="MOSChart"></canvas>
	<canvas id="lossChart"></canvas>
	<canvas id="delayChart"></canvas>
	<p id="consoleMessage"></p>
	<script src="data.js"></script>
</section>
