import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import { CacheCookieBehavior, CacheHeaderBehavior, CacheQueryStringBehavior, OriginRequestCookieBehavior, OriginRequestHeaderBehavior, OriginRequestQueryStringBehavior, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { BlockPublicAccess, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import path from 'path'

const __dirname = process.cwd();

type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>


export type SveltekitSiteProps = {
    lambdaProps?: PartialBy<Omit<cdk.aws_lambda.FunctionProps, 'code' | 'runtime' | 'handler'>, 'architecture' | 'timeout' | 'memorySize'>;
    cloudfrontProps?: Omit<cdk.aws_cloudfront.DistributionProps, 'defaultBehavior'> & {
        defaultBehavior: Omit<cdk.aws_cloudfront.BehaviorOptions, 'origin'>
    };
}

export class SvelteKitSite extends Construct {
    public svelteLambda : cdk.aws_lambda.Function
    public cloudfrontDistribution: cdk.aws_cloudfront.Distribution
    constructor(scope: Construct, id: string, props?: SveltekitSiteProps) {
        super(scope, id);

        const svelte = new cdk.aws_lambda.Function(this, `${id}-svelte-lambda`, {
            runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
            architecture: cdk.aws_lambda.Architecture.ARM_64,
            memorySize: 1024,
            timeout: Duration.seconds(10),
            handler: 'serverless.handler',
            code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, './build/server')),
            ...props?.lambdaProps,
        });

        const svelteURL = svelte.addFunctionUrl({ authType: FunctionUrlAuthType.NONE })

        const originAccessIdentity = new OriginAccessIdentity(this, `${id}-cloudfront-oai`, {
            comment: `Origin Access Identity for ${id} static assets`,
        });

        const staticAssets = new cdk.aws_s3.Bucket(this, `${id}-static-asset-bucket`, {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            accessControl: BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
        })

        staticAssets.addToResourcePolicy(new PolicyStatement({
            actions: ['s3:GetObject'],
            effect: Effect.ALLOW,
            resources: [staticAssets.arnForObjects('*')],
            sid: 'CloudFrontReadGetObject',
            principals: [new cdk.aws_iam.CanonicalUserPrincipal(originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId)]
        }))

        const forwardHeaderFunction = new cdk.aws_cloudfront.Function(this, `${id}-forward-header-function`, {
            code: cdk.aws_cloudfront.FunctionCode.fromInline(`function handler(event) {
                event.request.headers['x-forwarded-host'] = event.request.headers['host']
                return event.request
          }`),
        });

        new cdk.aws_s3_deployment.BucketDeployment(this, `${id}-deploy-prerender`, {
            sources: [cdk.aws_s3_deployment.Source.asset(path.join(__dirname, './build/prerendered'))],
            destinationBucket: staticAssets,
            prune: false,
            cacheControl: [
                cdk.aws_s3_deployment.CacheControl.maxAge(Duration.minutes(5)),
            ],
        });

        new cdk.aws_s3_deployment.BucketDeployment(this, `${id}-deploy-assets`, {
            sources: [cdk.aws_s3_deployment.Source.asset(path.join(__dirname, './build/assets/'))],
            destinationBucket: staticAssets,
            prune: false,
            cacheControl: [
                cdk.aws_s3_deployment.CacheControl.maxAge(Duration.days(365)),
                cdk.aws_s3_deployment.CacheControl.immutable(),
            ],
        });

        new cdk.aws_s3_deployment.BucketDeployment(this, `${id}-deploy-static`, {
            sources: [cdk.aws_s3_deployment.Source.asset(path.join(__dirname, './build/assets/_app'))],
            destinationBucket: staticAssets,
            destinationKeyPrefix: '_app',
            prune: false,
            cacheControl: [
                cdk.aws_s3_deployment.CacheControl.maxAge(Duration.days(365)),
                cdk.aws_s3_deployment.CacheControl.immutable(),
            ],
        });


        const distribution = new cdk.aws_cloudfront.Distribution(this, `${id}-svelte-cloudfront`, {
            ...props?.cloudfrontProps,
            defaultBehavior: {
                allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_ALL,
                origin: new cdk.aws_cloudfront_origins.HttpOrigin(cdk.Fn.select(2, cdk.Fn.split('/', svelteURL.url)), {
                    customHeaders: {
                        's3-host': staticAssets.bucketRegionalDomainName
                    }
                }),
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                compress: true,
                originRequestPolicy: new cdk.aws_cloudfront.OriginRequestPolicy(this, `${id}-svelte-orp`, {
                    cookieBehavior: OriginRequestCookieBehavior.all(),
                    queryStringBehavior: OriginRequestQueryStringBehavior.all(),
                    headerBehavior: OriginRequestHeaderBehavior.allowList('x-forwarded-host')
                }),
                cachePolicy: new cdk.aws_cloudfront.CachePolicy(this, `${id}-svelte-cp`, {
                    cookieBehavior: CacheCookieBehavior.all(),
                    queryStringBehavior: CacheQueryStringBehavior.all(),
                    headerBehavior: CacheHeaderBehavior.allowList('x-forwarded-host'),
                    enableAcceptEncodingBrotli: true,
                    enableAcceptEncodingGzip: true
                }),
                ...props?.cloudfrontProps?.defaultBehavior,
                edgeLambdas: [
                    ...(props?.cloudfrontProps?.defaultBehavior?.edgeLambdas || [])
                ],
                functionAssociations: [
                    {
                        function: forwardHeaderFunction,
                        eventType: cdk.aws_cloudfront.FunctionEventType.VIEWER_REQUEST,
                    },
                    ...(props?.cloudfrontProps?.defaultBehavior?.functionAssociations || [])
                ],
            },
            additionalBehaviors: {
                '/_app/immutable/*': {
                    allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                    cachedMethods: cdk.aws_cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                    origin: new cdk.aws_cloudfront_origins.S3Origin(staticAssets, {
                        originAccessIdentity: originAccessIdentity
                    }),
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: new cdk.aws_cloudfront.CachePolicy(this, `${id}-immutable-cache-policy`, {
                        queryStringBehavior: CacheQueryStringBehavior.none(),
                        headerBehavior: CacheHeaderBehavior.allowList('Origin'),
                        cookieBehavior: CacheCookieBehavior.none(),
                        defaultTtl: Duration.days(1),
                        maxTtl: Duration.days(365),
                        minTtl: Duration.days(0),
                        enableAcceptEncodingBrotli: true,
                        enableAcceptEncodingGzip: true,
                    }),
                }
            }
        });

        this.svelteLambda = svelte
        this.cloudfrontDistribution = distribution
    }
}