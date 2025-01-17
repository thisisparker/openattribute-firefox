var EXPORTED_SYMBOLS = ["ccffext"];

// Support for l10n of plurals
Components.utils.import("resource://gre/modules/PluralForm.jsm");

// RDFa parser
Components.utils.import("resource://ccffext/rdfa.js");

/**
 * Main extension object.
 * Behaves as a namespace for all code
 */
var ccffext =
{
    /**
     * An extension of the "Array" object's prototype. 
     * Inspired by Shamasis Bhattacharya's code
     * 
     * @return array An array of unique items
     * @see http://www.shamasis.net/2009/09/fast-algorithm-to-find-unique-items-in-javascript-array/
     */
    unique : function(in_array)
    {
	var object = {}, result = [];

	for(let i = 0; i < in_array.length; ++i)
	{
	    object[in_array[i]] = in_array[i];
	}
	
	for(let i in object)
	{
	    result.push(object[i]);
	}
	
	return result;
    },

    /**
     * Localization object that is used to fetch localized strings from a property file
     **/
    l10n :
    {
	/**
	 * Bundle holding all strings
	 **/
	bundle : Components.classes["@mozilla.org/intl/stringbundle;1"]
	    .getService(Components.interfaces.nsIStringBundleService)
	    .createBundle("chrome://ccffext/locale/locale.properties"),

	/**
	 * A lazy-initialized function for getting plurals
	 *
	 * @param number The number to be shown
	 * @param string A semicolon-separated string of plural forms containing the "%d" placeholders
	 * @return string A plural form with the placeholder substituted with the number
	 **/
	getPlural : undefined,

	/**
	 * Fetched a string by its name from the bundle
	 *
	 * @param name The name of a string
	 * @return string A string
	 */
	get : function(name,number)
	{
	    if ("undefined" == typeof number)
	    {
		// No plural forms, just get the string
		return ccffext.l10n.bundle.GetStringFromName(name);
	    }
	    else
	    {
		// Lazy-initialize the "getPlural" function
		if ("undefined" == typeof ccffext.l10n.getPlural)
		{
		    ccffext.l10n.getPlural = PluralForm
			.makeGetter(ccffext.l10n.bundle.GetStringFromName("l10n.plural.rule"))[0];
		}
		
		// Find appropriate plural form, substitute the placeholder
		return ccffext.l10n.getPlural(
		    number,
		    ccffext.l10n.bundle.GetStringFromName(name))
		    .replace("%d",number);
	    }
	}
    },

    /**
     * Cache of analysed pages that is used to store the RDFa information.
     * The "hashing" approach is used
     *
     * @see http://www.shamasis.net/2009/09/fast-algorithm-to-find-unique-items-in-javascript-array/
     **/
    cache :
    {
	/**
	 * The cache backend, initially empty
	 **/
	values : {},

	/**
	 * Checks if the cache contains an object by its key
	 *
	 * @param key A key
	 * @return boolean True if the cache contains the object, false otherwise
	 **/
	contains : function(key)
	{
	    return undefined != ccffext.cache.values[key];

	},


	containsDocument : function(document)
	{
	    var key = document.location.href;
	    var lastModified = document.lastModified;

	    return ((undefined != ccffext.cache.values[key]) &&
		    (lastModified == ccffext.cache.values[key]["__lastModified"]));

	},

	/**
	 * Stores a "key-object" pair in the cache
	 *
	 * @param key A key
	 * @param object An object
	 **/
	put : function(key,object)
	{
	    ccffext.cache.values[key] = object;
	},
	
	putDocument : function(document,object)
	{
	    ccffext.cache.values[document.location.href] = object;
	    ccffext.cache.values[document.location.href]["__lastModified"] = document.lastModified;
	},

	/**
	 * Fetches an object by its key from the cache
	 *
	 * @param key A key
	 **/
	get : function(key)
	{
	    return ccffext.cache.values[key];
	}
    },
    
    /**
     * Licensed objects (RDFa subjects) methods
     **/
    objects :
    {
	/**
	 * Top-level predicates that mark licensed objects
	 **/
	predicates : ["http://www.w3.org/1999/xhtml/vocab#license",
		      "http://creativecommons.org/ns#license",
		      "http://purl.org/dc/terms/license"
		     ],

	/**
	 * Returns a list of subjects with license assertions from a document.
	 *
	 * @param doc_uri The URI of the document containing the license assertions.
	 * @return array Array of objects
	 */
	getLicensedSubjects : function(doc_uri)
	{
	    
	    // get the set of statements extracted from the location
	    let statements = ccffext.cache.get(doc_uri).statements;
	    // get an array of subjects which have a license predicate
	    var subjects = [s.subject for each (s in statements) 
			    if (ccffext.objects.predicates.indexOf(s.predicate.uri) > -1)];

	    return ccffext.unique(subjects);
	},
	
	/**
	 * Returns an array of "predicate-object" pairs for the specified subject
	 *
	 * @param doc_uri The URI of the document containing the assertions.
	 * @param subject The subject object to return predicate-object pairs for.
	 * @return array An array of two element (predicate, object) arrays.
	 */
	getPredObjPairs : function(doc_uri,subject)
	{
	    var pairs = [];
	    
	    let statements = ccffext.cache.get(doc_uri).statements;
	    for (let i = 0; i < statements.length; ++i)
	    {
		if (statements[i].subject.uri == subject.uri)
		{
		    pairs.push([statements[i].predicate,statements[i].object]);
		}
	    }
	    
	    return pairs;
	},

	/**
	 * Return the first object for the given subject and predicate.
	 * 
	 * @param doc_uri The URI of the document containing the assertions.
	 * @param subject The subject object to match.
	 * @predicates array Predicates to search for, in order of preference.
	 * @return array An array of two element (predicate, object) arrays.
	 *
	 **/
	getValue : function(doc_uri, subject, predicates) {

	    for each (let p in predicates) {
		for (let i = 0, 
		     pairs = ccffext.objects.getPredObjPairs(doc_uri,subject); 
		     i < pairs.length; ++i) {
		    if (pairs[i][0].uri == p) {
			return pairs[i][1];
		    }
		}
	    }
	    
	    return undefined;

	}, // getValue

	/**
	 * Parses RDFa data of the given document and stores it in the cache
	 *
	 * @param location A string containing the URL of the document.
	 * @param document The document to be parsed
	 */
	parse : function(location, document)
	{

	    XH.transform(document.getElementsByTagName("body")[0]);
	    XH.transform(document.getElementsByTagName("head")[0]);
	    
	    RDFA.reset();
	    RDFA.parse(document);
	    
	    ccffext.cache.putDocument(document, RDFA.triplestore);

	    // Apply any site-specific hacks 
	    // -- these hacks are applied for high value adopters, who
	    // -- for whatever reason have adopted, ahem, imperfectly.
	    Components.utils.import("resource://ccffext/hacks/hacks.js");
	    for each (hack in ccffext_site_hacks.match(location)) {
		hack(ccffext.cache.get(location), location, document);
	    }

	    // see if the document contains license information
	    ccffext.objects.callbackify(
		document, 
		function (doc, objects) {

		    Components.utils.import("resource://ccffext/license.js");

		    // this document has licensed objects; 
		    // get the list of uncached licenses to retrieve
		    // and pass each to the license loader
		    [l.uri for each (l in ccffext.unique([
			    ccffext.objects.getLicense(location, subject)
			    for each (subject in objects) 
			if ("undefined" !== typeof subject)]) )
			if ("undefined" !== typeof l &&
			    !ccffext.cache.contains(l.uri))]

			.forEach(licenses.load);

		});

	},
	
	/**
	 * Checks if the cache contains the information for a document, calling a callback if not. Then calls a callback
	 * if the document has any licensed objects
	 */
	callbackify : function(document,callbackHas,callbackNotCached)
	{
	    const location = document.location.href;
	    
	    // For all pages, except for system ones like "about:blank", "about:config" and so on
	    if (! location.match(/^about\:/i))
	    {
		if (! ccffext.cache.containsDocument(document) && 
		    "function" == typeof callbackNotCached)
		{
		    callbackNotCached(document);
		}
		
		if (ccffext.cache.containsDocument(document))
		{
		    const objects = ccffext.objects.getLicensedSubjects(location);
		    
		    if (0 < objects.length && "function" == typeof callbackHas)
		    {
			callbackHas(document,objects);
		    }
		}
	    }
	},
	
	/**
	 * Returns a title for a licensed subject.
	 *
	 * @param doc_uri URI of the document to search assertions from.
	 * @param subject The subject to return the title of
	 */
	getTitle : function(doc_uri, subject)
	{
	    return ccffext.objects.getValue(
		doc_uri, subject,
		["http://purl.org/dc/terms/title",
		 "http://purl.org/dc/elements/1.1/title"]);
	},
	
	/**
	 * Returns the display title for a licensed subject. If no
	 * title is available, and the subject URI is the same as the
	 * document URI, return a localized string for "this page".
	 *
	 * @param doc_uri URI of the document to search assertions from.
	 * @param subject The subject to return the title of
	 */
	getDisplayTitle : function(doc_uri, subject) {

	    var title = ccffext.objects.getTitle(doc_uri, subject);

	    if (typeof title != "undefined") return title;
	    
	    return doc_uri == subject.uri
		? ccffext.l10n.get("object.title.current-page.label")
		: subject.uri;
	}, // getDisplayTitle

	/**
	 * Returns a type for a licensed object
	 *
	 * @param doc_uri URI of the document to search assertions from.
	 * @param object The object
	 */
	getType : function(doc_uri,object)
	{
	    var type = ccffext.objects.getValue(
		doc_uri, object, 
		["http://purl.org/dc/terms/type",
		 "http://purl.org/dc/elements/1.1/type"]);

	    if ("undefined" != typeof type) 
		return type.uri.replace("http://purl.org/dc/dcmitype/","");

	    return undefined;
	},

	/**
	 * Returns an author for a licensed object
	 *
	 * @param doc_uri URI of the document to search assertions from.
	 * @param object The object
	 */
	getAuthor : function(doc_uri,object)
	{
	    return ccffext.objects.getValue(
		doc_uri, object, 
		["http://creativecommons.org/ns#attributionName"]);
	},
	
	/**
	 * Returns an URI for an author for a licensed object
	 *
	 * @param doc_uri URI of the document to search assertions from.
	 * @param object The object
	 */
	getAuthorUri : function(doc_uri,object)
	{
	    return ccffext.objects.getValue(
		doc_uri, object, 
		["http://creativecommons.org/ns#attributionURL"]);
	},
	
	/**
	 * Returns a source for a licensed object.
	 *
	 * @param doc_uri URI of the document to search assertions from.
	 * @param object The object
	 */
	getSource : function(doc_uri, object)
	{
	    return object.uri;
	},

	/**
	 * Returns a source for a licensed object.
	 *
	 * @param doc_uri URI of the document to search assertions from.
	 * @param object The object
	 */
	getAttributionHtml : function(doc_uri, object) {

	    Components.utils.import("resource://ccffext/license.js");

	    // get the license and other bits of information for this object
	    license = licenses.getLicenseInfo(
		ccffext.objects.getLicense(doc_uri, object).uri);

	    title = ccffext.objects.getTitle(doc_uri, object);

	    identifier_name = null;
	    identifier_url = null;

	    attrib_name = ccffext.objects.getAuthor(doc_uri, object);
	    attrib_url = ccffext.objects.getAuthorUri(doc_uri, object);
	    
	    // create the pieces for the attribution HTML
	    attrib_pieces = new Array();
	    attrib_ns = new Object();

	    // -- title
	    if (title) {
		attrib_pieces.push(
		    '<a href="' + object.uri + '" property="dct:title">' + title + '</a>'
		);
		attrib_ns["dct"] = "http://purl.org/dc/terms/";
	    } else {

		// no attribution metadata available
		attrib_pieces.push(
		    'Work found at <a href="' + object.uri + '">' + 
			object.uri + '</a> ');	
	    }

	    // -- attrib name/URL
	    if ("undefined" != typeof attrib_name || 
		"undefined" != typeof attrib_url) {
		// we have at least one of the name + URL
		if ("undefined" == typeof attrib_url) {
		    // no attribution URL
		    attrib_pieces.push(
			'<span property="cc:attributionName">' + 
			    attrib_name + '</span>'
		    );

		} else // we have the attribution URL; see if we have the name
		    if ("undefined" == typeof attrib_name) {

			// w/o attrib_name we include the URL as the link text
			// but do not annotate it as the attribution name
			attrib_pieces.push(
			    '<a rel="cc:attributionURL" ' + 
				'href="' + attrib_url.uri + '">' + 
				attrib_url.uri +
				'</a>'
			);
			
		    } else {

			attrib_pieces.push(
			    '<a rel="cc:attributionURL" ' + 
				'property="cc:attributionName" ' + 
				'href="' + attrib_url.uri + '">' + 
				attrib_name + '</a>'
			);
		    }

		attrib_ns["cc"] = "http://creativecommons.org/ns#";
	    } // attribution name/url

	    // -- identifier / publisher
	    // -- XXX this is currently unimplemented, needed for PDM support

	    // -- license
	    attrib_pieces.push(
		'<a rel="license" href="' + license.uri + '">' +
		    (license.identifier ? license.identifier : license.name) + 
		    '</a>');

	    // assemble the final HTML from the pieces
	    attrib_html = '<span about="' + object.uri + '"';
	    for (var ns in attrib_ns) {
		attrib_html = attrib_html + ' xmlns:' + ns + '="' + attrib_ns[ns] + '"';
	    }

	    attrib_html = attrib_html + ">" + attrib_pieces.join(" / ") + "</span>";

	    return attrib_html;

	}, // getAtttributionHtml

	getAttributionText : function (doc_uri, object) {

	    Components.utils.import("resource://ccffext/license.js");

	    // get the license and other bits of information for this object
	    license = licenses.getLicenseInfo(
		ccffext.objects.getLicense(doc_uri, object).uri);

	    title = ccffext.objects.getTitle(doc_uri, object);

	    identifier_name = null;
	    identifier_url = null;

	    attrib_name = ccffext.objects.getAuthor(doc_uri, object);
	    attrib_url = ccffext.objects.getAuthorUri(doc_uri, object);
	    
	    // create the pieces for the attribution HTML
	    attrib_pieces = new Array();

	    // -- title
	    if (title) {
		attrib_pieces.push( title + " (" + object.uri + ")" );
	    } else {

		// no attribution metadata available
		attrib_pieces.push('Work found at ' + object.uri);

	    } 

	    // -- attrib name/URL
	    if ("undefined" != typeof attrib_name || 
		"undefined" != typeof attrib_url) {
		// we have at least one of the name + URL
		if ("undefined" == typeof attrib_url) {
		    // no attribution URL
		    attrib_pieces.push(attrib_name);

		} else // we have the attribution URL; see if we have the name
		    if ("undefined" == typeof attrib_name) {

			// w/o attrib_name we include the URL as the link text
			// but do not annotate it as the attribution name
			attrib_pieces.push("(" + attrib_url.uri + ")");
			
		    } else {

			attrib_pieces.push(
			    attrib_name + " (" + attrib_url.uri + ")");
		    }

	    } // attribution name/url

	    // -- identifier / publisher
	    // -- XXX this is currently unimplemented, needed for PDM support

	    // -- license
	    attrib_pieces.push(
		(license.identifier ? license.identifier : license.name) +
		    " (" + license.uri + ")");

	    // assemble the final text from the pieces
	    attrib_text = attrib_pieces.join(" / ");

	    return attrib_text;
	}, // getAttributionText

	// Return the license for the specified object
	getLicense : function(doc_uri, object) {

	    return ccffext.objects.getValue(
		doc_uri, object, ccffext.objects.predicates);

	},
    },
        
    /**
     * Utility function that writes a message to the JavaScript console
     *
     * @param message A message
     */
    log : function(message)
    {
	Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService)
	    .logStringMessage(message);
    }
};