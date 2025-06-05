import Head from 'next/head'

export default function Home() {
    return (
        <>
            <Head>
                <title>Simple Next.js App</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <link rel="icon" type="image/svg+xml" href="/StackForgeLogo.png" />
            </Head>

            <div className="template-wrapper">
                <img src="/StackForgeLogo.png" alt="StackForge Logo" />
                <h1>Stack Forge with Next.js</h1>
                <p>
                    This is a single page built with Next.js by the Stack Forge team for you to get started!
                </p>
                <a href="https://stackforgeengine.com" target="_blank" rel="noopener noreferrer">
                    https://stackforgeengine.com
                </a>
            </div>
        </>
    )
}
