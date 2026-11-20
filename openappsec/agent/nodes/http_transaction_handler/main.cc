 

#include "time_print.h"
#include "components_list.h"
#include "nginx_attachment.h"
#include "gradual_deployment.h"
#include "http_manager.h"
#include "layer_7_access_control.h"
#include "rate_limit.h"
#include "waap.h"
#include "ips_comp.h"
#include "keyword_comp.h"
#include "http_geo_filter.h"
#include "geo_location.h"

int
main(int argc, char **argv)
{
    NodeComponentsWithTable<
        SessionID,
        NginxAttachment,
        GradualDeployment,
        HttpManager,
        Layer7AccessControl,
        RateLimit,
        WaapComponent,
        IPSComp,
        KeywordComp,
        GeoLocation,
        HttpGeoFilter
    > comps;

    comps.registerGlobalValue<bool>("Is Rest primary routine", true);
    comps.registerGlobalValue<uint>("Nano service API Port Range start", 12000);
    comps.registerGlobalValue<uint>("Nano service API Port Range end", 13000);
    return comps.run("HTTP Transaction Handler", argc, argv);
}
