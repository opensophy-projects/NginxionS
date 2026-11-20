 

#include "central_nginx_manager.h"

#include "components_list.h"
#include "nginx_message_reader.h"

using namespace std;

int
main(int argc, char **argv)
{
    NodeComponents<CentralNginxManager, NginxMessageReader> comps;

    comps.registerGlobalValue<bool>("Is Rest primary routine", true);
    comps.registerGlobalValue<uint>("Nano service API Port Primary", 7555);
    comps.registerGlobalValue<uint>("Nano service API Port Alternative", 7556);

    return comps.run("Central NGINX Manager", argc, argv);
}
