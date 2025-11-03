# adapter-lambda for SvelteKit

An adapter to build a [SvelteKit](https://kit.svelte.dev/) app into a lambda ready for deployment with lambda proxy via the Serverless framework or CDK.

> **Note**: This is a fork of [@yarbsemaj/adapter-lambda](https://github.com/yarbsemaj/sveltekit-adapter-lambda) which has not received an update in over a year at the time of this fork. Go there for original documentation or read below for notable differences.

## Installation
```
npm install --save-dev @armaneous/adapter-lambda
```
## Usage

In your `svelte.config.js` configure the adapter as below;

```js
import serverless from '@armaneous/adapter-lambda';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: serverless() //See Below for optional arguments
	}
};

export default config;
```

## Notable Differences from Original

### Removed Router Runtime
Original adapter depended on a Lambda@Edge router to route requests for static files to S3. This lambda does away with the router, eliminating the need for a Lambda@Edge function, in favor of using the CloudFront distribution's caching/routing for an S3 origin request.

### Tightened Security Practices
Original S3 bucket used an open access policy that allowed access to all resources on the bucket. While that's not concerning because all resources in the bucket will be accessible through Cloudfront anyway, it's a more common practice to only allow access to those resources through Cloudfront so that the bucket itself is private. The changes here include adding a Cloudfront Origin Access Identity to accomplish the scoped access control, eliminating the need to keep the bucket open to the world and ensuring that all traffic must pass through the Cloudfront distribution.

## Infrastructure Diagram
(Pending update...)

## Issues and Pull Requests Welcome
I cannot guarantee timeliness, but I'll do my best. Please raise an issue on [Github](https://github.com/armaneous/sveltekit-adapter-lambda/issues), and I will be happy to work through it.
