/**
 * External dependencies
 */
import { parse } from 'url';
import { includes, kebabCase, toLower } from 'lodash';
import { stringify } from 'querystring';
import memoize from 'memize';

/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { Component, renderToString } from '@wordpress/element';
import { Button, Placeholder, Spinner, SandBox } from '@wordpress/components';
import classnames from 'classnames';

/**
 * Internal dependencies
 */
import './style.scss';
import './editor.scss';
import { createBlock } from '../../api';
import RichText from '../../rich-text';
import BlockControls from '../../block-controls';
import BlockAlignmentToolbar from '../../block-alignment-toolbar';

// These embeds do not work in sandboxes
const HOSTS_NO_PREVIEWS = [ 'facebook.com' ];

// Caches the embed API calls, so if blocks get transformed, or deleted and added again, we don't spam the API.
const wpEmbedAPI = memoize( ( url ) => wp.apiRequest( { path: `/oembed/1.0/proxy?${ stringify( { url } ) }` } ) );

const matchesPatterns = ( url, patterns ) => {
	return patterns.some( ( pattern ) => {
		return url.match( new RegExp( pattern, 'i' ) );
	} );
};

const findBlock = ( url ) => {
	const blocks = [ ...common, ...others ];
	for ( let i = 0; i < blocks.length; i++ ) {
		const blockSettings = blocks[ i ];
		if ( matchesPatterns( url, blockSettings.settings.patterns ) ) {
			return blockSettings.name;
		}
	}
	return 'core/embed';
};

function getEmbedBlockSettings( { title, icon, category = 'embed', transforms, keywords = [], patterns = [] } ) {
	return {
		title,

		description: __( 'The Embed block allows you to easily add videos, images, tweets, audio, and other content to your post or page.' ),

		icon,

		category,

		keywords,

		patterns,

		attributes: {
			url: {
				type: 'string',
			},
			caption: {
				type: 'array',
				source: 'children',
				selector: 'figcaption',
				default: [],
			},
			align: {
				type: 'string',
			},
			type: {
				type: 'string',
			},
			providerNameSlug: {
				type: 'string',
			},
		},

		transforms,

		getEditWrapperProps( attributes ) {
			const { align } = attributes;
			if ( 'left' === align || 'right' === align || 'wide' === align || 'full' === align ) {
				return { 'data-align': align };
			}
		},

		edit: class extends Component {
			constructor() {
				super( ...arguments );
				this.doServerSideRender = this.doServerSideRender.bind( this );
				this.state = {
					html: '',
					type: '',
					error: false,
					fetching: false,
					providerName: '',
				};
			}

			componentWillMount() {
				if ( this.props.attributes.url ) {
					// if the url is already there, we're loading a saved block, so we need to render
					// a different thing, which is why this doesn't use 'fetching', as that
					// is for when the user is putting in a new url on the placeholder form
					this.setState( { fetching: true } );
					this.doServerSideRender();
				}
			}

			componentWillUnmount() {
				// can't abort the fetch promise, so let it know we will unmount
				this.unmounting = true;
			}

			getPhotoHtml( photo ) {
				// 100% width for the preview so it fits nicely into the document, some "thumbnails" are
				// acually the full size photo.
				const photoPreview = <p><img src={ photo.thumbnail_url } alt={ photo.title } width="100%" /></p>;
				return renderToString( photoPreview );
			}

			doServerSideRender( event ) {
				if ( event ) {
					event.preventDefault();
				}
				const { url } = this.props.attributes;
				const { setAttributes } = this.props;

				// If we don't have any URL patterns, or we do and the URL doesn't match,
				// then we should look for a block that has a matching URL pattern.
				if ( ! patterns || ( patterns && ! matchesPatterns( url, patterns ) ) ) {
					const matchingBlock = findBlock( url );
					// WordPress blocks can work on multiple sites, and so don't have patterns.
					if ( 'core-embed/wordpress' !== this.props.name && 'core/embed' !== matchingBlock ) {
						// At this point, we have discovered a more suitable block for this url, so transform it.
						if ( this.props.name !== matchingBlock ) {
							this.props.onReplace( createBlock( matchingBlock, { url } ) );
							return;
						}
					}
				}

				this.setState( { error: false, fetching: true } );
				wpEmbedAPI( url )
					.then(
						( obj ) => {
							if ( this.unmounting ) {
								return;
							}
							// Some plugins put the embed html in `result`, so get the right one here.
							const html = obj.html ? obj.html : obj.result;
							// Some plugins only return HTML with no type info, so default this to 'rich'.
							let { type = 'rich' } = obj;
							// If we got a provider name from the API, use it for the slug, otherwise we use the title,
							// because not all embed code gives us a provider name.
							const { provider_name: providerName } = obj;
							const providerNameSlug = kebabCase( toLower( '' !== providerName ? providerName : title ) );
							if ( includes( html, 'class="wp-embedded-content" data-secret' ) ) {
								type = 'wp-embed';
								// If this is not the WordPress embed block, transform it into one, there's
								// no URL pattern that can detect WordPress embeds.
								if ( this.props.name !== 'core-embed/wordpress' ) {
									this.props.onReplace( createBlock( 'core-embed/wordpress', { url } ) );
									return;
								}
							}
							if ( html ) {
								this.setState( { html, type, providerNameSlug } );
								setAttributes( { type, providerNameSlug } );
							} else if ( 'photo' === type ) {
								this.setState( { html: this.getPhotoHtml( obj ), type, providerNameSlug } );
								setAttributes( { type, providerNameSlug } );
							}
							this.setState( { fetching: false } );
						},
						() => {
							this.setState( { fetching: false, error: true } );
						}
					);
			}

			render() {
				const { html, type, error, fetching } = this.state;
				const { align, url, caption } = this.props.attributes;
				const { setAttributes, isSelected } = this.props;
				const updateAlignment = ( nextAlign ) => setAttributes( { align: nextAlign } );

				const controls = isSelected && (
					<BlockControls key="controls">
						<BlockAlignmentToolbar
							value={ align }
							onChange={ updateAlignment }
						/>
					</BlockControls>
				);

				if ( fetching ) {
					return [
						controls,
						<div key="loading" className="wp-block-embed is-loading">
							<Spinner />
							<p>{ __( 'Embedding…' ) }</p>
						</div>,
					];
				}

				if ( ! html ) {
					const label = sprintf( __( '%s URL' ), title );

					return [
						controls,
						<Placeholder key="placeholder" icon={ icon } label={ label } className="wp-block-embed">
							<form onSubmit={ this.doServerSideRender }>
								<input
									type="url"
									value={ url || '' }
									className="components-placeholder__input"
									aria-label={ label }
									placeholder={ __( 'Enter URL to embed here…' ) }
									onChange={ ( event ) => setAttributes( { url: event.target.value } ) } />
								<Button
									isLarge
									type="submit">
									{ __( 'Embed' ) }
								</Button>
								{ error && <p className="components-placeholder__error">{ __( 'Sorry, we could not embed that content.' ) }</p> }
							</form>
						</Placeholder>,
					];
				}

				const parsedUrl = parse( url );
				const cannotPreview = includes( HOSTS_NO_PREVIEWS, parsedUrl.host.replace( /^www\./, '' ) );
				const iframeTitle = sprintf( __( 'Embedded content from %s' ), parsedUrl.host );
				const embedWrapper = 'wp-embed' === type ? (
					<div
						className="wp-block-embed__wrapper"
						dangerouslySetInnerHTML={ { __html: html } }
					/>
				) : (
					<div className="wp-block-embed__wrapper">
						<SandBox
							html={ html }
							title={ iframeTitle }
							type={ type }
						/>
					</div>
				);
				let typeClassName = 'wp-block-embed';
				if ( 'video' === type ) {
					typeClassName += ' is-video';
				}

				return [
					controls,
					<figure key="embed" className={ typeClassName }>
						{ ( cannotPreview ) ? (
							<Placeholder icon={ icon } label={ __( 'Embed URL' ) }>
								<p className="components-placeholder__error"><a href={ url }>{ url }</a></p>
								<p className="components-placeholder__error">{ __( 'Previews for this are unavailable in the editor, sorry!' ) }</p>
							</Placeholder>
						) : embedWrapper }
						{ ( caption && caption.length > 0 ) || isSelected ? (
							<RichText
								tagName="figcaption"
								placeholder={ __( 'Write caption…' ) }
								value={ caption }
								onChange={ ( value ) => setAttributes( { caption: value } ) }
								isSelected={ isSelected }
								inlineToolbar
							/>
						) : null }
					</figure>,
				];
			}
		},

		save( { attributes } ) {
			const { url, caption, align, type, providerNameSlug } = attributes;

			if ( ! url ) {
				return;
			}

			const embedClassName = classnames( 'wp-block-embed', {
				[ `is-align${ align }` ]: align,
				[ `is-type-${ type }` ]: type,
				[ `is-provider-${ providerNameSlug }` ]: providerNameSlug,
			} );

			return (
				<figure className={ embedClassName }>
					{ `\n${ url }\n` /* URL needs to be on its own line. */ }
					{ caption && caption.length > 0 && <figcaption>{ caption }</figcaption> }
				</figure>
			);
		},
	};
}

export const name = 'core/embed';

export const settings = getEmbedBlockSettings( {
	title: __( 'Embed' ),
	icon: 'embed-generic',
	transforms: {
		from: [
			{
				type: 'raw',
				isMatch: ( node ) => node.nodeName === 'P' && /^\s*(https?:\/\/\S+)\s*/i.test( node.textContent ),
				transform: ( node ) => {
					return createBlock( 'core/embed', {
						url: node.textContent.trim(),
					} );
				},
			},
		],
	},
} );

export const common = [
	{
		name: 'core-embed/twitter',
		settings: getEmbedBlockSettings( {
			title: 'Twitter',
			icon: 'embed-post',
			keywords: [ __( 'tweet' ) ],
			patterns: [ '^https?:\/\/(www\.)?twitter\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/youtube',
		settings: getEmbedBlockSettings( {
			title: 'YouTube',
			icon: 'embed-video',
			keywords: [ __( 'music' ), __( 'video' ) ],
			patterns: [ '^https?:\/\/((m|www)\.)?youtube\.com\/.+', 'youtu\.be\/.+' ],
		} ),
	},
	{
		name: 'core-embed/facebook',
		settings: getEmbedBlockSettings( {
			title: 'Facebook',
			icon: 'embed-post',
			patterns: [ '^https?:\/\/www\.facebook.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/instagram',
		settings: getEmbedBlockSettings( {
			title: 'Instagram',
			icon: 'embed-photo',
			keywords: [ __( 'image' ) ],
			patterns: [ '^https?:\/\/(www\.)?instagr(\.am|am\.com)/.+' ],
		} ),
	},
	{
		name: 'core-embed/wordpress',
		settings: getEmbedBlockSettings( {
			title: 'WordPress',
			icon: 'embed-post',
			keywords: [ __( 'post' ), __( 'blog' ) ],
		} ),
	},
	{
		name: 'core-embed/soundcloud',
		settings: getEmbedBlockSettings( {
			title: 'SoundCloud',
			icon: 'embed-audio',
			keywords: [ __( 'music' ), __( 'audio' ) ],
			patterns: [ '^https?:\/\/(www\.)?soundcloud\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/spotify',
		settings: getEmbedBlockSettings( {
			title: 'Spotify',
			icon: 'embed-audio',
			keywords: [ __( 'music' ), __( 'audio' ) ],
			patterns: [ '^https?:\/\/(open|play)\.spotify\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/flickr',
		settings: getEmbedBlockSettings( {
			title: 'Flickr',
			icon: 'embed-photo',
			keywords: [ __( 'image' ) ],
			patterns: [ '^https?:\/\/(www\.)?flickr\.com\/.+', 'flic\.kr/.+' ],
		} ),
	},
	{
		name: 'core-embed/vimeo',
		settings: getEmbedBlockSettings( {
			title: 'Vimeo',
			icon: 'embed-video',
			keywords: [ __( 'video' ) ],
			patterns: [ '^https?:\/\/(www\.)?vimeo\.com\/.+' ],
		} ),
	},
];

export const others = [
	{
		name: 'core-embed/animoto',
		settings: getEmbedBlockSettings( {
			title: 'Animoto',
			icon: 'embed-video',
			patterns: [ '^https?:\/\/(www\.)?(animoto|video214)\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/cloudup',
		settings: getEmbedBlockSettings( {
			title: 'Cloudup',
			icon: 'embed-post',
			patterns: [ '^https?:\/\/cloudup\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/collegehumor',
		settings: getEmbedBlockSettings( {
			title: 'CollegeHumor',
			icon: 'embed-video',
			patterns: [ '^https?:\/\/(www\.)?collegehumor\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/dailymotion',
		settings: getEmbedBlockSettings( {
			title: 'Dailymotion',
			icon: 'embed-video',
			patterns: [ '^https?:\/\/(www\.)?dailymotion\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/funnyordie',
		settings: getEmbedBlockSettings( {
			title: 'Funny or Die',
			icon: 'embed-video',
			patterns: [ '(www\.)?funnyordie\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/hulu',
		settings: getEmbedBlockSettings( {
			title: 'Hulu',
			icon: 'embed-video',
			patterns: [ '^https?:\/\/(www\.)?hulu\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/imgur',
		settings: getEmbedBlockSettings( {
			title: 'Imgur',
			icon: 'embed-photo',
			patterns: [ '^https?:\/\/(.+\.)?imgur\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/issuu',
		settings: getEmbedBlockSettings( {
			title: 'Issuu',
			icon: 'embed-post',
			patterns: [ '^https?:\/\/(www\.)?issuu\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/kickstarter',
		settings: getEmbedBlockSettings( {
			title: 'Kickstarter',
			icon: 'embed-post',
			patterns: [ '^https?:\/\/(www\.)?kickstarter\.com\/.+', '^https?:\/\/kck\.st/.+' ],
		} ),
	},
	{
		name: 'core-embed/meetup-com',
		settings: getEmbedBlockSettings( {
			title: 'Meetup.com',
			icon: 'embed-post',
			patterns: [ '^https?:\/\/(www\.)?meetu(\.ps|p\.com)\/.+' ],
		} ),
	},
	{
		name: 'core-embed/mixcloud',
		settings: getEmbedBlockSettings( {
			title: 'Mixcloud',
			icon: 'embed-audio',
			keywords: [ __( 'music' ), __( 'audio' ) ],
			patterns: [ '^https?:\/\/(www\.)?mixcloud\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/photobucket',
		settings: getEmbedBlockSettings( {
			title: 'Photobucket',
			icon: 'embed-photo',
			patterns: [ '^http:\/\/g?i*\.photobucket\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/polldaddy',
		settings: getEmbedBlockSettings( {
			title: 'Polldaddy',
			icon: 'embed-post',
			patterns: [ '^https?:\/\/(www\.)?mixcloud\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/reddit',
		settings: getEmbedBlockSettings( {
			title: 'Reddit',
			icon: 'embed-post',
			patterns: [ '^https?:\/\/(www\.)?reddit\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/reverbnation',
		settings: getEmbedBlockSettings( {
			title: 'ReverbNation',
			icon: 'embed-audio',
			patterns: [ '^https?:\/\/(www\.)?reverbnation\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/screencast',
		settings: getEmbedBlockSettings( {
			title: 'Screencast',
			icon: 'embed-video',
			patterns: [ '^https?:\/\/(www\.)?screencast\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/scribd',
		settings: getEmbedBlockSettings( {
			title: 'Scribd',
			icon: 'embed-post',
			patterns: [ '^https?:\/\/(www\.)?scribd\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/slideshare',
		settings: getEmbedBlockSettings( {
			title: 'Slideshare',
			icon: 'embed-post',
			patterns: [ '^https?:\/\/(.+?\.)?slideshare\.net\/.+' ],
		} ),
	},
	{
		name: 'core-embed/smugmug',
		settings: getEmbedBlockSettings( {
			title: 'SmugMug',
			icon: 'embed-photo',
			patterns: [ '^https?:\/\/(www\.)?smugmug\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/speaker',
		settings: getEmbedBlockSettings( {
			title: 'Speaker',
			icon: 'embed-audio',
			patterns: [ '^https?:\/\/(www\.)?speakerdeck\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/ted',
		settings: getEmbedBlockSettings( {
			title: 'TED',
			icon: 'embed-video',
			patterns: [ '^https?:\/\/(www\.|embed\.)?ted\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/tumblr',
		settings: getEmbedBlockSettings( {
			title: 'Tumblr',
			icon: 'embed-post',
			patterns: [ '^https?:\/\/(www\.)?tumblr\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/videopress',
		settings: getEmbedBlockSettings( {
			title: 'VideoPress',
			icon: 'embed-video',
			keywords: [ __( 'video' ) ],
			patterns: [ '^https?:\/\/videopress\.com\/.+' ],
		} ),
	},
	{
		name: 'core-embed/wordpress-tv',
		settings: getEmbedBlockSettings( {
			title: 'WordPress.tv',
			icon: 'embed-video',
			patterns: [ '^https?:\/\/wordpress\.tv\/.+' ],
		} ),
	},
];
