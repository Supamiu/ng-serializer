import 'reflect-metadata';
import { Class, Instantiable } from './class';
import { METADATA_PARENT } from './decorator/parent';
import { ParentOptions } from './decorator/parent-options';
import { ProcessedRegistration, Registration } from './registration';

/**
 * The registry allows the serializer to handle inheritance.
 *
 * ## Example with the default registry:
 * ```typescript
 * // Create a new Serializer with the default registry.
 * const serializer = new Serializer();
 *
 * // Then add registrations to the inner registry.
 * serializer.registry.add([
 *      {
 *          parent: Foo,
 *          children: {
 *              bar: Bar,
 *              baz: Baz,
 *          }
 *      }
 * ]);
 * ```
 *
 * ## Example with a specific registry:
 * ```typescript
 * // Create the registry.
 * const registry = new Registry();
 * registry.add([
 *      {
 *          parent: Foo,
 *          children: {
 *              bar: Bar,
 *              baz: Baz,
 *          }
 *      }
 * ]);
 *
 * // Then create a Serializer with a specific registry.
 * const serializer = new Serializer(registry);
 *
 * // It is always possible to register new classes after, or to add entries to already known classes.
 * registry.add([
 *      {
 *          parent: Foo,
 *          children: {
 *              bar: NewBar,
 *          }
 *      }
 * ]);
 * ```
 */
export class Registry {

    /**
     * Our current registrations for inheritance handling.
     */
    private _registrations = new Map<Class, ProcessedRegistration>();

    /**
     * Adds the given registrations to the registry.
     */
    public add(registration: Registration[]): void {
        for (const reg of registration) {

            const parent = reg.parent;
            let children: { [index: string]: Class };
            let parentOptions: ParentOptions;

            //We check if the parent has already been registered
            const existingReg = this._registrations.get(reg.parent);
            if (existingReg !== undefined) {
                //Merge existing children with the new children
                children = {...existingReg.children, ...reg.children};
                //Re-use the parent options from the previous registration (no reflect-metadata needed)
                parentOptions = existingReg.parentOptions;
            } else {
                children = reg.children;

                const discriminatorHandler = reg.discriminatorHandler || reg.parent;

                //Get the metadata for this parent and check if it has the @Parent decorator.
                parentOptions = Reflect.getOwnMetadata(METADATA_PARENT, discriminatorHandler);
                if (parentOptions === undefined) {
                    throw new TypeError(`Class ${discriminatorHandler.name} needs a @Parent decorator to be registered`);
                }
            }

            // Flag to know if the parent is registered among its children.
            let parentHasExplicitDiscriminator = false;

            for (const value in reg.children) {
                const child = reg.children[value];

                //Check if the child is the parent itself
                if (child === reg.parent) {
                    if (!parentOptions.allowSelf) {
                        throw new TypeError(`Class ${reg.parent.name} cannot be registered among its children`);
                    }

                    parentHasExplicitDiscriminator = true;
                } else {
                    //Check if the child extends the parent
                    if (!(child.prototype instanceof reg.parent)) {
                        throw new TypeError(`Class ${child.name} needs to extend ${reg.parent.name} to be registered as a child`);
                    }
                }
            }

            this._registrations.set(reg.parent, {parent, children, parentOptions, parentHasExplicitDiscriminator});
        }
    }

    /**
     * Use the class `Parent` metadata in combination with the registrations to find
     * the correct class for the given object.
     * @returns the class of the given object.
     */
    public findClass<T, V extends T>(clazz: Class<T>, obj: any): Instantiable<V> {
        const registration = this._registrations.get(clazz);

        // If we don't have metadata for inheritance, it doesn't concern the registry.
        if (registration === undefined) {
            return clazz as Instantiable;
        }

        //Let's get the trackBy method to have the key from current value.
        const trackBy = registration.parentOptions.trackBy;

        let discriminatorValue: string;

        if (trackBy === undefined) {
            discriminatorValue = obj[registration.parentOptions.discriminatorField];
        } else {
            discriminatorValue = trackBy(obj[registration.parentOptions.discriminatorField], obj);
        }

        // In case of missing discriminator value...
        if (discriminatorValue === undefined || discriminatorValue === null) {
            // ...check if the parent allows itself and no explicit discriminators are defined.
            if (!registration.parentOptions.allowSelf || registration.parentHasExplicitDiscriminator) {
                throw new TypeError(`Missing attribute type to discriminate the subclass of ${clazz.name}`);
            }

            return clazz as Instantiable;
        }

        return this.getInstantiable(registration, obj, discriminatorValue.toString());
    }

    /**
     * Used to get the class from our registrations using the parent class and the current discriminator value.
     *
     * @returns the class we're looking for, or the parent if none is found.
     */
    private getInstantiable(registration: ProcessedRegistration, obj: any, discriminatorValue: string): Instantiable {
        const child = registration.children[discriminatorValue];

        if (child === undefined) {
            //Method findClass already handle the case for implicit parent discrimination with undefined discriminator
            throw new TypeError(`No matching subclass for parent class ${registration.parent.name} \
with discriminator value ${discriminatorValue}.`);
        }

        if (child === registration.parent) {
            return registration.parent as Instantiable;
        }

        return this.findClass(child, obj);
    }

}
