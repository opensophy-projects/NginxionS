 

#include "components_list.h"
#include "attachment_registrator.h"

int
main(int argc, char **argv)
{
    NodeComponents<AttachmentRegistrator> comps;
    comps.registerGlobalValue<bool>("Is Rest primary routine", true);
    comps.registerGlobalValue<uint>("Nano service API Port Primary", 8124);
    comps.registerGlobalValue<uint>("Nano service API Port Alternative", 8127);
    return comps.run("Attachment Registration Manager", argc, argv);
}
