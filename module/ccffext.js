var EXPORTED_SYMBOLS = ["ccffext"];

/**
 * An extension of the "Array" object's prototype. 
 * Inspired by Shamasis Bhattacharya's code
 *
 * @return array An array of unique items
 * @see http://www.shamasis.net/2009/09/fast-algorithm-to-find-unique-items-in-javascript-array/
 */
Array.prototype.unique = function()
{
    var object = {}, result = [];

    for(let i = 0; i < this.length; ++i)
    {
	object[this[i]] = this[i];
    }

    for(let i in object)
    {
	result.push(object[i]);
    }

    return result;
};

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
	 * Finds licensed objects in a page
	 *
	 * @param document The document containing licensed objects
	 * @return array Array of objects
	 */
	getLicensedSubjects : function(document)
	{
	    
	    // get the set of statements extracted from the location
	    let statements = ccffext.cache.get(document.location.href).statements;
	    // get an array of subjects which have a license predicate
	    var subjects = [s.subject for each (s in statements) 
			    if (ccffext.objects.predicates.indexOf(s.predicate.uri) > -1)];

	    return subjects.unique();
	},
	
	/**
	 * Returns an array of two-element "predicate-object" pairs for the licenced object (RDFa subject)
	 *
	 * @param document The document containing licensed objects
	 * @return subject The object (RDFa subject)
	 */
	getPredObjPairs : function(document,subject)
	{
	    var pairs = [];
	    
	    let statements = statements = ccffext.cache.get(document.location.href).statements;
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
	 * Predicates is an array of predicates to search for, in order
	 * of preference.
	 * 
	 **/
	getValue : function(document, subject, predicates) {

	    for each (let p in predicates) {
		for (let i = 0, 
		     pairs = ccffext.objects.getPredObjPairs(document,subject); 
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
	 * @param document The document to be parsed
	 * @param RDFA RDFA object
	 * @param XH XH object
	 */
	parse : function(location,document)
	{
	    XH.transform(document.getElementsByTagName("body")[0]);
	    XH.transform(document.getElementsByTagName("head")[0]);
	    
	    RDFA.reset();
	    RDFA.parse(document);
	    
	    ccffext.cache.put(location,RDFA.triplestore);
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
		if (! ccffext.cache.contains(location) && "function" == typeof callbackNotCached)
		{
		    callbackNotCached(document);
		}
		
		if (ccffext.cache.contains(location))
		{
		    const objects = ccffext.objects.getLicensedSubjects(document);
		    
		    if (0 < objects.length && "function" == typeof callbackHas)
		    {
			callbackHas(document,objects);
		    }
		}
	    }
	},
	
	/**
	 * Returns a title for a licensed object.
	 *
	 * @param document The analysed document
	 * @param object The object
	 */
	getTitle : function(document,object)
	{
	    return ccffext.objects.getValue(
		document, object,
		["http://purl.org/dc/terms/title",
		 "http://purl.org/dc/elements/1.1/title"]);
	},
	
	getDisplayTitle : function(document, object) {

	    var title = ccffext.objects.getTitle(document, object);

	    if (typeof title != "undefined") return title;
	    
	    return document.location.href == object.uri
		? ccffext.l10n.get("object.title.current-page.label")
		: object.uri;
	}, // getDisplayTitle

	/**
	 * Returns a type for a licensed object
	 *
	 * @param document The analysed document
	 * @param object The object
	 */
	getType : function(document,object)
	{
	    var type = ccffext.objects.getValue(
		document, object, 
		["http://purl.org/dc/terms/type",
		 "http://purl.org/dc/elements/1.1/type"]);

	    if ("undefined" != typeof type) 
		return type.uri.replace("http://purl.org/dc/dcmitype/","");

	    return undefined;
	},

	/**
	 * Returns an author for a licensed object
	 *
	 * @param document The analysed document
	 * @param object The object
	 */
	getAuthor : function(document,object)
	{
	    return ccffext.objects.getValue(
		document, object, 
		["http://creativecommons.org/ns#attributionName"]);
	},
	
	/**
	 * Returns an URI for an author for a licensed object
	 *
	 * @param document The analysed document
	 * @param object The object
	 */
	getAuthorUri : function(document,object)
	{
	    return ccffext.objects.getValue(
		document, object, 
		["http://creativecommons.org/ns#attributionURL"]);
	},
	
	/**
	 * Returns a source for a licensed object.
	 *
	 * @param document The analysed document
	 * @param object The object
	 */
	getSource : function(document,object)
	{
	    return object.uri;
	},

	getAttributionHtml : function(document, object, callback) {

	    // get the license and other bits of information for this object
	    license_uri = ccffext.objects.getLicense(document, object).uri;

	    title = ccffext.objects.getTitle(document, object);

	    identifier_name = null;
	    identifier_url = null;

	    attrib_name = ccffext.objects.getAuthor(document, object);
	    attrib_url = ccffext.objects.getAuthorUri(document, object);
	    
	    // create the pieces for the attribution HTML
	    attrib_pieces = new Array();
	    attrib_ns = new Object();

	    // -- title
	    if (title) {
		attrib_pieces.push(
		    '<span property="dct:title">' + title + '</span>'
		);
		attrib_ns["dct"] = "http://purl.org/dc/terms/";
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
	    // XXX need to get the license name/short name
	    attrib_pieces.push(
		'<a rel="license" href="' + license_uri + '">' +
		    license_uri + '</a>');

	    // assemble the final HTML from the pieces
	    attrib_html = '<div about="' + object.uri + '"';
	    for (var ns in attrib_ns) {
		attrib_html = attrib_html + ' xmlns:' + ns + '="' + attrib_ns[ns] + '"';
	    }

	    attrib_html = attrib_html + ">" + attrib_pieces.join(" / ") + "</div>";

	    callback(document, object, attrib_html);

	}, // getAtttributionHtml

	// Return the license for the specified object
	getLicense : function(document, object) {

	    return ccffext.objects.getValue(
		document, object, ccffext.objects.predicates);

	},

	/**
	 * Returns information about the license
	 *
	 * @param document The analysed document
	 * @param object The object
	 * @param callback Callback when the license details have been retrieved;
	 *        This is called with the signature (document, object, license).
	 */
	getLicenseDetails : function(document,object, callback, license_frame)
	{

	    var license =
		{
		    name : undefined,
		    uri : undefined,
		    code : undefined,
		    color : undefined
		};
	    
	    license.uri = license.name = ccffext.objects.getLicense(document, object).uri;
	    
	    if ("undefined" != typeof license.uri &&
		license.uri.indexOf("http://creativecommons.org/") == 0)
	    {
		// This is a Creative Commons license;
		// make sure we're using the canonical URI
		if (license.uri.lastIndexOf("/") < license.uri.length - 1) {
		    // strip off the trailing bit
		    license.uri = license.uri.slice(0, license.uri.lastIndexOf("/") + 1);
		}

		// extract the license code
		var re_license_code = /http:\/\/creativecommons\.org\/(licenses|publicdomain)\/([a-z\-\+]+)\/.*/
		license.code = license.uri.match(re_license_code)[2];

		// determine the license "color"
		switch (license.code) {
		case "by":
		case "by-sa":
		case "mark":
		case "zero":
		case "publicdomain":
		    license.color = "green";
		    break;

		case "by-nc":
		case "by-nd":
		case "by-nc-nd":
		case "by-nc-sa":
		case "sampling+":
		case "nc-sampling+":
		    license.color = "yellow";
		    break;

		case "sampling":
		case "devnations":
		    license.color = red;
		    break;
		}
	    }

	    // retrieve the license document to introspect for RDFa
	    if ("undefined" != typeof license_frame) {

		// see if we need to configure this license_frame
		if (!license_frame.hasAttribute("ccffext_configured")) {
		    license_frame.webNavigation.allowAuth = true;
		    license_frame.webNavigation.allowImages = false;
		    license_frame.webNavigation.allowJavascript = false;
		    license_frame.webNavigation.allowMetaRedirects = true;
		    license_frame.webNavigation.allowPlugins = false;
		    license_frame.webNavigation.allowSubframes = false;

		    license_frame.addEventListener(
			"DOMContentLoaded", 
			function (e) {

			    var doc = e.originalTarget;
			    var url = doc.location.href;
			    
			    // parse the license document for RDFa
			    ccffext.objects.parse(url, doc);
			    
			    // see if we have the license name
			    license.name = ccffext.objects.getValue(
				doc, {'uri':url}, 
				["http://purl.org/dc/terms/title",
				 "http://purl.org/dc/elements/1.1/title"]);
			    
			    if ("string" == typeof license.name) {
				license.name = license.name.trim();
			    }
			    
			    // call the callback when done
			    callback (document, object, license);
			    
			}, true);
		    
		    license_frame.setAttribute("ccffext_configured", true);
		}; // configure license_frame

		license_frame.webNavigation.loadURI(
		    license.uri,
		    Components.interfaces.nsIWebNavigation, null, null, null);

	    } // if a license frame was provided 
	    else {
		// make sure the call back happens, 
		// even if we can't load the license
		callback (document, object, license);
	    }

	    return license;

	} // getLicenseDetails
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