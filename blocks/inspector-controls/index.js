/**
 * WordPress dependencies
 */
import { Fill } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { ifEditBlockSelected } from '../block-edit/context';

export function InspectorControls( { children } ) {
	return (
		<Fill name="Inspector.Controls">
			{ children }
		</Fill>
	);
}

export default ifEditBlockSelected( InspectorControls );
