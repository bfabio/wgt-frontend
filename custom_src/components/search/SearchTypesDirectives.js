goog.provide('ga_search_type_directives');

goog.require('ga_browsersniffer_service');
goog.require('ga_debounce_service');
goog.require('ga_layer_metadata_popup_service');
goog.require('ga_map_service');
goog.require('ga_marker_overlay_service');
goog.require('ga_search_service');
goog.require('ga_topic_service');
goog.require('ga_urlutils_service');
(function () {

    //---START---
    /*
     var originToZoomLevel = {
     address: 10,
     parcel: 10,
     gazetteer: 10
     };
     */
    //---END---

    //+++START+++
    var originToZoomLevel = {
        top010: 7,
        partCat: 7,
        feature: 7
    };
    //+++END+++

    var parseExtent = function (stringBox2D) {
        var extent = stringBox2D.replace(/(BOX\(|\))/gi, '').replace(',', ' ')
            .split(' ');
        return $.map(extent, parseFloat);
    };

    var addOverlay = function (gaOverlay, map, res) {
        var visible = originToZoomLevel.hasOwnProperty(res.attrs.origin);
        //---START---
        //var center = [res.attrs.y, res.attrs.x];
        //---END---
        //+++START+++
        var center = [res.attrs.x, res.attrs.y];
        //+++END+++
        if (!res.attrs.y || !res.attrs.x) {
            center = ol.proj.transform([res.attrs.lon, res.attrs.lat],
                'EPSG:4326', 'EPSG:21781');
        }
        gaOverlay.add(map,
            center,
            parseExtent(res.attrs.geom_st_box2d),
            visible);

    };

    var removeOverlay = function (gaOverlay, map) {
        gaOverlay.remove(map);
    };

    var listenerMoveEnd;
    var registerMove = function (gaOverlay, gaDebounce, map) {
        listenerMoveEnd = map.on('moveend', gaDebounce.debounce(function () {
            var zoom = map.getView().getZoom();
            gaOverlay.setVisibility(zoom);
        }, 200, false, false));
    };

    var unregisterMove = function () {
        if (listenerMoveEnd) {
            ol.Observable.unByKey(listenerMoveEnd);
            listenerMoveEnd = undefined;
        }
    };

    var tabStarts = [
        100000,
        200000,
        300000
    ];

    var nextTabGroup = function (val) {
        for (var i = 0; i < tabStarts.length - 1; i++) {
            if (val >= tabStarts[i] &&
                val < tabStarts[i + 1]) {
                return tabStarts[i + 1];
            }
        }
        return undefined;
    };

    var prevTabGroup = function (val) {
        for (var i = tabStarts.length - 1; i > 0; i--) {
            if (val >= tabStarts[i]) {
                return tabStarts[i - 1];
            }
        }
        return undefined;
    };

    var focusElement = function (el, evt) {
        evt.preventDefault();
        el[0].focus();
    };

    var elExists = function (el) {
        if (el.length === 1 &&
            el[0].className.indexOf('ga-search-result') > -1) {
            return true;
        }
        return false;
    };

    var focusToElement = function (next, step, evt) {
        var newEl = undefined;
        if (next) {
            newEl = $(evt.target).nextAll('.ga-search-result').first();
        } else {
            newEl = $(evt.target).prevAll('.ga-search-result').first();
        }
        if (elExists(newEl)) {
            var existingEl = newEl;
            step -= 1;
            while (step > 0 && elExists(newEl)) {
                existingEl = newEl;
                step -= 1;
                if (next) {
                    newEl = newEl.nextAll('.ga-search-result').first();
                } else {
                    newEl = newEl.prevAll('.ga-search-result').first();
                }
            }
            focusElement(existingEl, evt);
        } else {
            focusToCategory(next, evt);
        }
    };

    var focusToCategory = function (next, evt) {
        var el = $(evt.target);
        if (el.length && el[0] && el[0].attributes && el[0].attributes.tabindex) {
            var jumpGroup;
            if (next) {
                jumpGroup = nextTabGroup(el[0].attributes.tabindex.value);
                while (jumpGroup) {
                    var newEl = $('[tabindex=' + jumpGroup + ']');
                    if (elExists(newEl)) {
                        focusElement(newEl, evt);
                        break;
                    }
                    jumpGroup = nextTabGroup(jumpGroup);
                }
            } else {
                jumpGroup = prevTabGroup(el[0].attributes.tabindex.value);
                while (jumpGroup) {
                    var newEl = $('[tabindex=' + jumpGroup + ']');
                    if (elExists(newEl)) {
                        var existingEl = newEl;
                        //Go to last element of category
                        while (elExists(newEl)) {
                            existingEl = newEl;
                            jumpGroup += 1;
                            newEl = $('[tabindex=' + jumpGroup + ']');
                        }
                        focusElement(existingEl, evt);
                        return;
                    }
                    jumpGroup = prevTabGroup(jumpGroup);
                }
                //Nothing found, so jump back to input (ignore bad design...)
                var newEl = $('.ga-search-input');
                if (newEl.length === 1 &&
                    newEl[0].className.indexOf('ga-search-input') > -1) {
                    focusElement(newEl, evt);
                }
            }
        }
    };

    var module = angular.module('ga_search_type_directives', [
        'ga_browsersniffer_service',
        'ga_debounce_service',
        'ga_layer_metadata_popup_service',
        'ga_map_service',
        'ga_marker_overlay_service',
        'ga_search_service',
        'ga_urlutils_service',
        'pascalprecht.translate',
        'ga_topic_service'
    ]);

    /*
     * We have 3 distinct directives for each type of result
     * set (locations, features and layers)
     *
     * All 3 result directives share the same template and the
     * same controller code. Put anything that is common for
     * all 3 types in the controller code.
     *
     * Put type specific behaviour in the corresponding
     * directive's code.
     */

    module.controller('GaSearchTypesController',
        function ($scope, $http, $q, $sce, gaUrlUtils, gaSearchLabels,
                  gaBrowserSniffer, gaMarkerOverlay, gaDebounce, gaTopic) {

            // This value is used to block blur/mouseleave event, when a value
            // is selected. See #2284. It's reinitialized when a new search is
            // triggered.
            var blockEvent = false;
            var canceler;

            var cancel = function () {
                $scope.results = [];
                $scope.fuzzy = '';
                if (canceler !== undefined) {
                    canceler.resolve();
                    canceler = undefined;
                }
            };

            var triggerSearch = gaDebounce.debounce(function () {
                if (!$scope.doSearch($scope.options, gaTopic.get())) {
                    $scope.options.announceResults($scope.type, 0);
                    return;
                }

                canceler = $q.defer();

                var url = gaUrlUtils.append($scope.options.baseUrl,
                    'type=' + $scope.type);
                url = $scope.typeSpecificUrl(url);

                $http.get(url, {
                    cache: true,
                    timeout: canceler.promise
                }).success(function (data) {
                    $scope.results = data.results;
                    if (data.fuzzy) {
                        $scope.fuzzy = '_fuzzy';
                    }
                    $scope.options.announceResults($scope.type, data.results.length);
                }).error(function (data, statuscode) {
                    // If request is canceled, statuscode is 0 and we don't announce it
                    if (statuscode !== 0) {
                        $scope.options.announceResults($scope.type, 0);
                    }
                });
            }, 133, false, false);
            // 133 filters out 'stuck key' events while staying responsive

            $scope.doSearch = function (opt, current_topic) {
                return true;
            };

            $scope.typeSpecificUrl = function (url) {
                return url;
            };

            $scope.keydown = function (evt, res) {
                if (evt.keyCode == 13) {
                    //Enter key
                    $scope.removePreview();
                    blockEvent = true;
                    $scope.select(res);
                } else if (evt.keyCode == 9) {
                    //Tab key
                    focusToCategory(!evt.shiftKey, evt);
                } else if (evt.keyCode == 40 || evt.keyCode == 34) {
                    //Down Arrow or PageDown key
                    focusToElement(true, evt.keyCode == 40 ? 1 : 5, evt);
                } else if (evt.keyCode == 38 || evt.keyCode == 33) {
                    //Up Arrow or PageUp key
                    focusToElement(false, evt.keyCode == 38 ? 1 : 5, evt);
                }
            };

            $scope.click = function (res) {
                $scope.removePreview();
                blockEvent = true;
                $scope.select(res);
            };

            $scope.out = function (evt) {
                if (!blockEvent) {
                    $scope.removePreview();
                }
            };

            $scope.preview = function (res) {
                if (gaBrowserSniffer.mobile) {
                    return;
                }
                addOverlay(gaMarkerOverlay, $scope.map, res);
            };

            $scope.removePreview = function () {
                if (gaBrowserSniffer.mobile) {
                    return;
                }
                removeOverlay(gaMarkerOverlay, $scope.map);
            };

            $scope.prepareLabel = function (attrs) {
                var h = gaSearchLabels.highlight(attrs.label, $scope.options.query);
                return $sce.trustAsHtml(h);
            };

            $scope.cleanLabel = function (attrs) {
                return gaSearchLabels.cleanLabel(attrs.label);
            };

            $scope.fuzzy = '';

            $scope.$watch('options.query', function (newval) {
                //cancel old requests
                cancel();
                if (newval != '') {
                    blockEvent = false;
                    triggerSearch();
                } else {
                    unregisterMove();
                }
            });
        }
    );

    module.directive('gaSearchLocations',
        function ($http, $q, $sce, $translate, gaUrlUtils, gaBrowserSniffer,
                  gaMarkerOverlay, gaSearchLabels, gaMapUtils, gaDebounce) {
            return {
                restrict: 'A',
                templateUrl: 'components/search/partials/searchtypes.html',
                scope: {
                    options: '=gaSearchLocationsOptions',
                    map: '=gaSearchLocationsMap',
                    ol3d: '=gaSearchLocationsOl3d'
                },
                controller: 'GaSearchTypesController',
                link: function ($scope, element, attrs) {
                    $scope.type = 'locations';
                    $scope.tabstart = tabStarts[0];

                    // Can be removed onnce real type contains gazetter
                    $scope.typeSpecificUrl = function (url) {
                        //---START---
                        //return url.replace('type=locations', 'type=locations_preview');
                        //---END---
                        //+++START+++
                        return url.replace('type=locations', 'type=toponym');
                        //+++END+++
                    };

                    $scope.select = function (res) {
                        var isGazetteerPoly = false;
                        var e = parseExtent(res.attrs.geom_st_box2d);
                        unregisterMove();
                        //Gazetteer results that are not points zoom to full bbox extent
                        if (res.attrs.origin == 'gazetteer') {
                            isGazetteerPoly = (Math.abs(e[0] - e[2]) > 0.1 &&
                            Math.abs(e[1] - e[3]) > 0.1);

                        }
                        var ol3d = $scope.ol3d;
                        if (originToZoomLevel.hasOwnProperty(res.attrs.origin) && !isGazetteerPoly) {
                            //---START---
                            //gaMapUtils.moveTo($scope.map, $scope.ol3d, originToZoomLevel[res.attrs.origin], [res.attrs.y, res.attrs.x]);
                            //---END---
                            //+++START+++
                            gaMapUtils.moveTo($scope.map, $scope.ol3d, originToZoomLevel[res.attrs.origin], [res.attrs.x, res.attrs.y]);
                            //+++END+++
                        } else {
                            gaMapUtils.zoomToExtent($scope.map, $scope.ol3d, e);
                        }
                        addOverlay(gaMarkerOverlay, $scope.map, res);
                        $scope.options.valueSelected(
                            gaSearchLabels.cleanLabel(res.attrs.label));

                        registerMove(gaMarkerOverlay, gaDebounce, $scope.map);
                    };

                    $scope.prepareLabel = function (attrs) {
                        var l = gaSearchLabels.highlight(attrs.label,
                            $scope.options.query);
                        if (attrs.origin == 'zipcode') {
                            l = '<span>' + $translate.instant('plz') + ' ' + l +
                                '</span>';
                        } else if (attrs.origin == 'kantone') {
                            l = '<span>' + $translate.instant('ct') + ' ' + l +
                                '</span>';
                        } else if (attrs.origin == 'district') {
                            l = '<span>' + $translate.instant('district') + ' ' + l +
                                '</span>';
                        } else if (attrs.origin == 'parcel') {
                            l += ' <span>' + $translate.instant('parcel') + ' ' +
                                '</span>';
                        }
                        return $sce.trustAsHtml(l);
                    };

                }
            };
        });

    module.directive('gaSearchFeatures',
        function ($rootScope, $http, $q, $sce, $timeout, gaUrlUtils,
                  gaLayerFilters, gaSearchLabels, gaLayers, gaBrowserSniffer,
                  gaMarkerOverlay, gaPreviewFeatures, gaTopic, gaMapUtils) {

            var selectedFeatures = {};
            //---START---
            /*
             var loadGeometry = function(layerId, featureId, topic, urlbase, cb) {
             var key = layerId + featureId;
             if (!selectedFeatures.hasOwnProperty(key)) {
             var featureUrl = urlbase.replace('{Topic}', topic)
             .replace('{Layer}', layerId)
             .replace('{Feature}', featureId);
             $http.get(featureUrl, {
             params: {
             geometryFormat: 'geojson'
             }
             }).success(function(result) {
             selectedFeatures[key] = result.feature;
             cb(result.feature);
             });
             } else {
             $timeout(function() {
             cb(selectedFeatures[key]);
             }, 0, false);
             }
             };
             */
            //---END---
            //+++START+++
            var loadGeometry = function (res, topic, urlbase, cb) {
                var layerId = res.attrs.layer;
                var featureId = res.attrs.featureId;
                var key = layerId + featureId;
                if (!selectedFeatures.hasOwnProperty(key)) {
                    var featureUrl = urlbase;
                    $http.get(featureUrl, {
                        params: {
                            geometryFormat: 'geojson',
                            layer: layerId,
                            feature: featureId
                        }
                    }).success(function (result) {
                        selectedFeatures[key] = result.results;
                        cb(result.results, res);
                    });
                } else {
                    $timeout(function () {
                        cb(selectedFeatures[key], res);
                    }, 0, false);
                }
            };
            //+++END+++

            return {
                restrict: 'A',
                templateUrl: 'components/search/partials/searchtypes.html',
                scope: {
                    options: '=gaSearchFeaturesOptions',
                    map: '=gaSearchFeaturesMap',
                    ol3d: '=gaSearchFeaturesOl3d'
                },
                controller: 'GaSearchTypesController',
                link: function ($scope, element, attrs) {
                    var geojsonParser = new ol.format.GeoJSON();
                    var searchableLayers = [];
                    var timeEnabled = [];
                    var timeStamps = [];

                    $scope.type = 'featuresearch';
                    $scope.tabstart = tabStarts[1];

                    $scope.doSearch = function (opt, current_topic) {
                        return searchableLayers.length > 0;
                    };

                    $scope.typeSpecificUrl = function (url) {
                        var bbox = function (map) {
                            var size = map.getSize();
                            var view = map.getView();
                            var bounds = view.calculateExtent(size);
                            return bounds.join(',');
                        };
                        url = gaUrlUtils.append(url, 'bbox=' + bbox($scope.map));
                        //---START---
                        //url = gaUrlUtils.append(url, 'features=' + searchableLayers.join(','));
                        //---END---
                        //+++START+++
                        url = gaUrlUtils.append(url, 'queryLayers=' + searchableLayers.join(','));
                        //+++END+++
                        url = gaUrlUtils.append(url,
                            'timeEnabled=' + timeEnabled.join(','));
                        return gaUrlUtils.append(url,
                            'timeStamps=' + timeStamps.join(','));
                    };

                    $scope.select = function (res) {
                        unregisterMove();
                        //---START---
                        /*
                         loadGeometry(res.attrs.layer, res.attrs.featureId,
                         gaTopic.get().id,
                         $scope.options.featureUrl, function(f) {
                         $rootScope.$broadcast('gaTriggerTooltipRequest', {
                         features: [f],
                         onCloseCB: angular.noop
                         });
                         var feature = geojsonParser.readFeature(f);
                         gaPreviewFeatures.zoom($scope.map, $scope.ol3d, feature);
                         });
                         */
                        //---END---
                        //+++START+++
                        loadGeometry(res, gaTopic.get().id, $scope.options.featureUrl, function (f) {
                            $rootScope.$broadcast('gaTriggerTooltipRequest', {
                                features: [f],
                                onCloseCB: angular.noop
                            });
                            var feature = geojsonParser.readFeature(f, res);
                            gaPreviewFeatures.zoom($scope.map, $scope.ol3d, feature);
                        });
                        //+++END+++

                        $scope.options.valueSelected(
                            gaSearchLabels.cleanLabel(res.attrs.label));
                    };

                    $scope.prepareLabel = function (attrs) {
                        var l = gaSearchLabels.highlight(attrs.label,
                            $scope.options.query);
                        if (attrs.origin == 'feature') {
                            l = '<b>' +
                                gaLayers.getLayerProperty(attrs.layer, 'label') +
                                '</b><br>' + l;
                        }
                        return $sce.trustAsHtml(l);
                    };


                    $scope.layers = $scope.map.getLayers().getArray();
                    $scope.searchableLayersFilter = gaLayerFilters.searchable;

                    $scope.$watchCollection('layers | filter:searchableLayersFilter',
                        function (layers) {
                            //TODO: this isn't updated when layers param (like 'time') changes
                            searchableLayers = [];
                            timeEnabled = [];
                            timeStamps = [];
                            angular.forEach(layers, function (layer) {
                                var ts = '';
                                if (layer.time && layer.time.substr(0, 4) != '9999') {
                                    ts = layer.time.substr(0, 4);
                                }
                                searchableLayers.push(layer.bodId);
                                timeEnabled.push(layer.timeEnabled);
                                timeStamps.push(ts);
                            });
                        });

                }
            };
        });

    module.directive('gaSearchLayers',
        function ($http, $q, $sce, $window, gaUrlUtils, gaSearchLabels, gaBrowserSniffer,
                  gaPreviewLayers, gaMapUtils, gaLayers, gaGlobalOptions, gaLayerMetadataPopup) {
            return {
                restrict: 'A',
                templateUrl: 'components/search/partials/searchtypes.html',
                scope: {
                    options: '=gaSearchLayersOptions',
                    map: '=gaSearchLayersMap'
                },
                controller: 'GaSearchTypesController',
                link: function ($scope, element, attrs) {
                    $scope.type = 'layers';
                    $scope.tabstart = tabStarts[2];

                    $scope.preview = function (res) {
                        if (gaBrowserSniffer.mobile) {
                            return;
                        }
                        var layer = gaMapUtils.getMapOverlayForBodId($scope.map, res.attrs.layer);

                        // Don't add preview layer if the layer is already on the map
                        if (!layer || !layer.visible) {
                            /////// SET "INTERDIZIONE"
                            // var gaLayers = angular.element(document.body).injector().get('gaLayers');
                            var interdizioneScala = gaLayers.getLayerProperty(res.attrs.layer, 'interdizioneScalaNominale');
                            if (interdizioneScala == true) {
                                var scalaNominale = gaLayers.getLayerProperty(res.attrs.layer, 'scalaNominale');
                                //if has a value, set it to not visible!
                                if (!scalaNominale) {
                                    $window.console.error("[addPreviewLayer] Layer has 'interdizioneScalaNominale' but no 'scalaNominale'");
                                    return;
                                }

                                //Check if layer has value (inderdizioneScalaNominale) and (scalaNominale), otherwise skip layer
                                var actualScale = gaGlobalOptions.scales[$scope.map.getView().getZoom()];
                                if (scalaNominale == actualScale) {
                                    //Don't add the layer
                                    return;
                                }
                                $window.console.info("[addPreviewLayer] Adding Layer: " + res.attrs.layer + ", scalaNominale: " + scalaNominale + ", scalaAttuale: " + actualScale);
                                gaPreviewLayers.addBodLayer($scope.map, res.attrs.layer);
                            } else {
                                //////////// PREVIOUS CODE, WITHOUT "INTERDIZIONE"
                                gaPreviewLayers.addBodLayer($scope.map, res.attrs.layer);
                            }

                        }
                    };

                    $scope.removePreview = function () {
                        gaPreviewLayers.removeAll($scope.map);
                    };

                    $scope.select = function (res) {
                        unregisterMove();
                        var l = gaMapUtils.getMapOverlayForBodId($scope.map,
                            res.attrs.layer);
                        if (!angular.isDefined(l)) {
                            var olLayer = gaLayers.getOlLayerById(res.attrs.layer);
                            $scope.map.addLayer(olLayer);
                        } else {
                            // Assure layer is visible
                            l.visible = true;
                        }
                        $scope.options.valueSelected(
                            gaSearchLabels.cleanLabel(res.attrs.label));
                    };

                    $scope.getLegend = function (evt, bodId) {
                        gaLayerMetadataPopup.toggle(bodId);
                        evt.stopPropagation();
                    };
                }
            };
        });


    //+++START+++
    module.directive('gaSearchCadastre',
        function ($rootScope, $http, $q, $sce, $timeout, gaUrlUtils,
                  gaLayerFilters, gaSearchLabels, gaLayers, gaBrowserSniffer,
                  gaMarkerOverlay, gaPreviewFeatures, gaTopic, gaMapUtils) {

            var selectedFeatures = {};
            var loadGeometry = function (res, topic, urlbase, cb) {
                var layerId = res.attrs.layerBodId;
                var featureId = res.attrs.featureID;
                var key = layerId + featureId;
                if (!selectedFeatures.hasOwnProperty(key)) {
                    var featureUrl = urlbase;
                    $http.get(featureUrl, {
                        params: {
                            geometryFormat: 'geojson',
                            layer: layerId,
                            feature: featureId
                        }
                    }).success(function (result) {
                        selectedFeatures[key] = result.results;
                        cb(result.results, res);
                    });
                } else {
                    $timeout(function () {
                        cb(selectedFeatures[key], res);
                    }, 0, false);
                }
            };


            return {
                restrict: 'A',
                templateUrl: 'components/search/partials/searchtypes.html',
                scope: {
                    options: '=gaSearchCadastreOptions',
                    map: '=gaSearchCadastreMap',
                },
                controller: 'GaSearchTypesController',
                link: function ($scope, element, attrs) {
                    var geojsonParser = new ol.format.GeoJSON();
                    var searchableLayers = [];
                    var timeEnabled = [];
                    var timeStamps = [];

                    $scope.type = 'cadastre';
                    $scope.tabstart = tabStarts[1];

                    $scope.doSearch = function (opt, current_topic) {
                        //return /^[a-zA-Z]{3,999} (?:(?:\.?[0-9]+)|(?:[0-9]+\/[0-9]+))$/.test(opt.query);
                        return /^[a-zA-Z]{3,999} (?:\.?[0-9]+)(?:\/[0-9]+)?$/.test(opt.query);
                    };

                    $scope.typeSpecificUrl = function (url) {
                        return url;
                    };

                    $scope.select = function (res) {
                        unregisterMove();
                        loadGeometry(res, gaTopic.get().id, $scope.options.featureUrl, function (f) {
                            $rootScope.$broadcast('gaTriggerTooltipRequest', {
                                features: [f],
                                onCloseCB: angular.noop
                            });
                            var l = gaMapUtils.getMapOverlayForBodId($scope.map, res.attrs.layerBodId);
                            if (!angular.isDefined(l)) {
                                var olLayer = gaLayers.getOlLayerById(res.attrs.layerBodId);
                                $scope.map.addLayer(olLayer);
                            } else {
                                // Assure layer is visible
                                l.visible = true;
                            }
                            var feature = geojsonParser.readFeature(f, res);
                            gaPreviewFeatures.zoom($scope.map, $scope.ol3d, feature);
                        });
                        $scope.options.valueSelected(gaSearchLabels.cleanLabel(res.attrs.label));
                    };

                    $scope.prepareLabel = function (attrs) {
                        var l = gaSearchLabels.highlight(attrs.label,
                            $scope.options.query);
                        if (attrs.origin == 'feature') {
                            l = '<b>' +
                                gaLayers.getLayerProperty(attrs.layer, 'label') +
                                '</b><br>' + l;
                        }
                        return $sce.trustAsHtml(l);
                    };


                    $scope.layers = $scope.map.getLayers().getArray();
                    $scope.searchableLayersFilter = gaLayerFilters.searchable;

                    $scope.$watchCollection('layers | filter:searchableLayersFilter',
                        function (layers) {
                            //TODO: this isn't updated when layers param (like 'time') changes
                            searchableLayers = [];
                            timeEnabled = [];
                            timeStamps = [];
                            angular.forEach(layers, function (layer) {
                                var ts = '';
                                if (layer.time && layer.time.substr(0, 4) != '9999') {
                                    ts = layer.time.substr(0, 4);
                                }
                                searchableLayers.push(layer.bodId);
                                timeEnabled.push(layer.timeEnabled);
                                timeStamps.push(ts);
                            });
                        });

                }
            };
        });


    module.directive('gaSearchBioSpecies',
        function ($http, $q, $sce, $window, gaUrlUtils, gaSearchLabels, gaBrowserSniffer,
                  gaPreviewLayers, gaMapUtils, gaLayers, gaGlobalOptions, gaLayerMetadataPopup) {
            return {
                restrict: 'A',
                templateUrl: 'components/search/partials/searchtypes.html',
                scope: {
                    options: '=gaSearchBioSpeciesOptions',
                    map: '=gaSearchBioSpeciesMap'
                },
                controller: 'GaSearchTypesController',
                link: function ($scope, element, attrs) {
                    $scope.type = 'species';
                    $scope.tabstart = tabStarts[2];

                    $scope.preview = function (res) {
                        if (gaBrowserSniffer.mobile) {
                            return;
                        }

                        //riumuovo i layer cercati e caricati precedentemente
                        $scope.map.getLayers().forEach(function (l) {
                            try {
                                // se i layer contiene il parametro 'layer_dett', allora è un layer associato alla specie
                                var layer_dett = l.getSource().getParams().layer_dett;
                                if (layer_dett) {
                                    $scope.map.removeLayer(l);
                                }
                            } catch (e) {
                            }
                        });

                        for (var i = 0; i < res.attrs.layers.length; i++) {
                            var l = gaLayers.getOlLayerById(res.attrs.layers[i]);
                            if (l) {
                                l.getSource().updateParams({CQL_FILTER: "taxon_fk='" + res.attrs.speciesID + "'"});
                            }

                            var layer = gaMapUtils.getMapOverlayForBodId($scope.map, res.attrs.layers[i]);
                            // Don't add preview layer if the layer is already on the map
                            if (!layer || !layer.visible) {



                                // Don't add preview layer if the layer is already on the map
                                if (!layer || !layer.visible) {
                                    /////// SET "INTERDIZIONE"
                                    // var gaLayers = angular.element(document.body).injector().get('gaLayers');
                                    var interdizioneScala = gaLayers.getLayerProperty(res.attrs.layers[i], 'interdizioneScalaNominale');
                                    if (interdizioneScala == true) {
                                        var scalaNominale = gaLayers.getLayerProperty(res.attrs.layers[i], 'scalaNominale');
                                        //if has a value, set it to not visible!
                                        if (!scalaNominale) {
                                            $window.console.error("[addPreviewLayer] Layer has 'interdizioneScalaNominale' but no 'scalaNominale'");
                                            return;
                                        }

                                        //Check if layer has value (inderdizioneScalaNominale) and (scalaNominale), otherwise skip layer
                                        var actualScale = gaGlobalOptions.scales[$scope.map.getView().getZoom()];
                                        if (scalaNominale == actualScale) {
                                            //Don't add the layer
                                            return;
                                        }
                                        $window.console.info("[addPreviewLayer] Adding Layer: " + res.attrs.layers[i] + ", scalaNominale: " + scalaNominale + ", scalaAttuale: " + actualScale);
                                        gaPreviewLayers.addBodLayer($scope.map, res.attrs.layers[i]);
                                    } else {
                                        //////////// PREVIOUS CODE, WITHOUT "INTERDIZIONE"
                                        gaPreviewLayers.addBodLayer($scope.map, res.attrs.layers[i]);
                                    }

                                }
                            }
                        }
                    };

                    $scope.removePreview = function () {
                        gaPreviewLayers.removeAll($scope.map);
                    };

                    $scope.select = function (res) {
                        unregisterMove();
                        for (var i = 0; i < res.attrs.layers.length; i++) {
                            var l = gaLayers.getOlLayerById(res.attrs.layers[i]);
                            if (l) {
                                l.getSource().updateParams({CQL_FILTER: "taxon_fk='" + res.attrs.speciesID + "'"});
                                l.getSource().updateParams({layer_dett: res.attrs.speciesID});
                            }

                            var l = gaMapUtils.getMapOverlayForBodId($scope.map, res.attrs.layers[i]);
                            if (!angular.isDefined(l)) {
                                var olLayer = gaLayers.getOlLayerById(res.attrs.layers[i]);
                                olLayer.label = res.attrs.speciesCommonName;
                                $scope.map.addLayer(olLayer);
                            } else {
                                // Assure layer is visible
                                l.visible = true;
                                l.label = res.attrs.speciesCommonName;
                            }
                            $scope.options.valueSelected(gaSearchLabels.cleanLabel(res.attrs.label));
                        }
                    };

                    $scope.getLegend = function (evt, bodId) {
                        gaLayerMetadataPopup.toggle(bodId);
                        evt.stopPropagation();
                    };

                    $scope.doSearch = function (opt, current_topic) {
                        return (current_topic.id == 3);
                    };
                }
            };
        });
    //+++END+++

})();
